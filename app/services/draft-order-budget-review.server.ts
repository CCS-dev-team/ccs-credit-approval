import { BudgetDecisionService } from "./budget-decision.server";
import { ShopifyBudgetProvider } from "./shopify-budget-provider.server";
import { logger } from "../lib/logger.server";
import { markDraftSubmittedForApproval } from "./mark-draft-submitted-for-approval.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type DraftOrderBudgetReviewResult = {
  ok: true;
  notify: boolean;
  emailSent: boolean;
  notificationStatus: "not_required" | "sent" | "failed";
  budgetStatus: "within_limit" | "exceeded";
  budgetReason: string;
  budgetTriggerScope: "customer" | "company" | "both" | "none";
  approverEmail: string;
  fallbackUsed: boolean;
  companyName: string;
  companyLocationName: string;
  draftOrderId: string;
  draftOrderName: string;
  orderTotal: string;
  currency: string;
  creditLimit: string;
  remainingCredit: string;
  amountExceededBy: string;
  customerCreditLimit: string;
  customerRemainingCredit: string;
  customerAmountExceededBy: string;
  companyCreditLimit: string;
  companyRemainingCredit: string;
  companyAmountExceededBy: string;
  invoiceUrl: string;
  reviewUrl: string;
  emailSubject: string;
  emailBody: string;
};

export class DraftOrderBudgetReviewError extends Error {
  code:
    | "BAD_REQUEST"
    | "DRAFT_NOT_FOUND"
    | "UPSTREAM_UNAVAILABLE"
    | "INTERNAL_ERROR";

  constructor(
    code:
      | "BAD_REQUEST"
      | "DRAFT_NOT_FOUND"
      | "UPSTREAM_UNAVAILABLE"
      | "INTERNAL_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "DraftOrderBudgetReviewError";
    this.code = code;
  }
}

type DraftOrderGraphqlResponse = {
  data?: {
    draftOrder?: {
      id: string;
      name: string;
      totalPrice: string | number | null;
      presentmentCurrencyCode?: string | null;
      invoiceUrl?: string | null;
      customer?: {
        id: string;
      } | null;
      purchasingEntity?: {
        __typename?: string;
        company?: {
          id: string;
          name: string | null;
        } | null;
        location?: {
          id: string;
          name: string | null;
        } | null;
        contact?: {
          id: string;
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type MetafieldsSetResponse = {
  data?: {
    metafieldsSet?: {
      metafields?: Array<{
        key: string;
        namespace: string;
        value: string;
      }>;
      userErrors?: Array<{
        field?: string[];
        message: string;
        code?: string;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

export async function reviewDraftOrderBudget({
  admin,
  shopDomain,
  draftOrderId,
  draftOrderName,
}: {
  admin: AdminGraphqlClient;
  shopDomain: string;
  draftOrderId: string;
  draftOrderName: string | null;
}): Promise<DraftOrderBudgetReviewResult> {
  const draftOrder = await getDraftOrderForBudgetReview({
    admin,
    draftOrderId,
  });

  if (!draftOrder) {
    throw new DraftOrderBudgetReviewError(
      "DRAFT_NOT_FOUND",
      `Draft order ${draftOrderId} could not be found`,
    );
  }

  const purchasingEntity = draftOrder.purchasingEntity;

  if (
    purchasingEntity?.__typename !== "PurchasingCompany" ||
    !purchasingEntity.company?.id ||
    !purchasingEntity.location?.id
  ) {
    throw new DraftOrderBudgetReviewError(
      "BAD_REQUEST",
      "Draft order is not a B2B purchasing company draft order",
    );
  }

  const customerId = draftOrder.customer?.id;

  if (!customerId) {
    throw new DraftOrderBudgetReviewError(
      "BAD_REQUEST",
      "Draft order does not have a customer attached",
    );
  }

  const companyId = purchasingEntity.company.id;
  const companyName = purchasingEntity.company.name ?? "";
  const companyLocationId = purchasingEntity.location.id;
  const companyLocationName = purchasingEntity.location.name ?? "";

  const provider = new ShopifyBudgetProvider(admin);
  const decisionService = new BudgetDecisionService(provider);

  const orderTotalValue = toNumber(draftOrder.totalPrice);
  const currency = draftOrder.presentmentCurrencyCode ?? "AUD";

  const decision = await decisionService.resolve({
    customerId,
    companyId,
    companyLocationId,
    orderTotal: orderTotalValue,
  });

  const notify = decision.status === "exceeded";
  const resolvedApproverEmail = decision.approverEmail ?? "";

  const invoiceUrl = draftOrder.invoiceUrl ?? "";
  const reviewUrl = buildDraftOrderAdminUrl(shopDomain, draftOrder.id) || "";

  const amountExceededBy = formatDecimal(decision.amountExceededBy);
  const orderTotalFormatted = formatDecimal(orderTotalValue);

  const customerCreditLimitFormatted = formatDecimal(
    decision.customerLimitApplied ?? 0,
  );
  const customerRemainingCreditFormatted = formatDecimal(
    decision.customerRemainingSnapshot ?? 0,
  );
  const customerAmountExceededByFormatted = formatDecimal(
    decision.customerAmountExceededBy,
  );

  const companyCreditLimitFormatted = formatDecimal(
    decision.companyLimitApplied ?? 0,
  );
  const companyRemainingCreditFormatted = formatDecimal(
    decision.companyRemainingSnapshot ?? 0,
  );
  const companyAmountExceededByFormatted = formatDecimal(
    decision.companyAmountExceededBy,
  );

  const creditLimitFormatted = formatDecimal(decision.limitApplied ?? 0);
  const remainingCreditFormatted = formatDecimal(
    decision.remainingSnapshot ?? 0,
  );

  const emailSubject = notify
    ? `B2B draft order ${draftOrder.name} submitted for approval`
    : "";

  const emailBody = notify
    ? buildApprovalEmailBody({
        draftOrderName: draftOrder.name,
        companyName,
        companyLocationName,
        orderTotal: orderTotalFormatted,
        currency,
        invoiceUrl,
        reason: decision.reason,
        triggerScope: decision.triggerScope,
        customerCreditLimit: customerCreditLimitFormatted,
        customerRemainingCredit: customerRemainingCreditFormatted,
        customerAmountExceededBy: customerAmountExceededByFormatted,
        companyCreditLimit: companyCreditLimitFormatted,
        companyRemainingCredit: companyRemainingCreditFormatted,
        companyAmountExceededBy: companyAmountExceededByFormatted,
      })
    : "";

  let emailSent = false;
  let notificationStatus: "not_required" | "sent" | "failed" = "not_required";
  let notifiedAt: string | null = null;

  if (notify) {
    const markSubmittedResult = await markDraftSubmittedForApproval({
      shop: shopDomain,
      draftOrderId: draftOrder.id,
      graphql: (query, options) => admin.graphql(query, options),
    });

    if (!markSubmittedResult.ok) {
      logger.error(
        {
          event: "draft-order-budget-review.mark-submitted-failed",
          draftOrderId: draftOrder.id,
          companyId,
          companyLocationId,
          customerId,
          approverEmail: resolvedApproverEmail,
          error: markSubmittedResult.error,
        },
        "Failed to mark draft order as submitted for approval",
      );

      emailSent = false;
      notificationStatus = "failed";
      notifiedAt = null;
    } else {
      // Compatibility note:
      // emailSent/notificationStatus are preserved for the existing result contract.
      // In the new flow, "sent" means the submission-notification flow was successfully
      // triggered by marking workflow.approval_state = submitted. The actual email is
      // sent asynchronously by the draft-order webhook flow.
      emailSent = true;
      notificationStatus = "sent";
      notifiedAt = null;
    }
  }

  await writeDraftOrderBudgetMetafields({
    admin,
    draftOrderId: draftOrder.id,
    decision,
    notificationStatus,
    notifiedAt,
  });

  logger.info(
    {
      event: "draft-order-budget-review.complete",
      draftOrderId: draftOrder.id,
      customerId,
      companyId,
      companyLocationId,
      budgetStatus: decision.status,
      budgetReason: decision.reason,
      budgetTriggerScope: decision.triggerScope,
      notify,
      approverEmail: resolvedApproverEmail,
      emailSent,
      notificationStatus,
    },
    "Draft order budget review completed",
  );

  return {
    ok: true,
    notify,
    emailSent,
    notificationStatus,
    budgetStatus: decision.status,
    budgetReason: decision.reason,
    budgetTriggerScope: decision.triggerScope,
    approverEmail: resolvedApproverEmail,
    fallbackUsed: decision.fallbackUsed,
    companyName,
    companyLocationName,
    draftOrderId: draftOrder.id,
    draftOrderName: draftOrderName ?? draftOrder.name,
    orderTotal: orderTotalFormatted,
    currency,
    creditLimit: creditLimitFormatted,
    remainingCredit: remainingCreditFormatted,
    amountExceededBy,
    customerCreditLimit: customerCreditLimitFormatted,
    customerRemainingCredit: customerRemainingCreditFormatted,
    customerAmountExceededBy: customerAmountExceededByFormatted,
    companyCreditLimit: companyCreditLimitFormatted,
    companyRemainingCredit: companyRemainingCreditFormatted,
    companyAmountExceededBy: companyAmountExceededByFormatted,
    invoiceUrl,
    reviewUrl,
    emailSubject,
    emailBody,
  };
}

async function getDraftOrderForBudgetReview({
  admin,
  draftOrderId,
}: {
  admin: AdminGraphqlClient;
  draftOrderId: string;
}) {
  const query = `#graphql
    query GetDraftOrderForBudgetReview($id: ID!) {
      draftOrder(id: $id) {
        id
        name
        totalPrice
        presentmentCurrencyCode
        invoiceUrl
        customer {
          id
        }
        purchasingEntity {
          __typename
          ... on PurchasingCompany {
            company {
              id
              name
            }
            location {
              id
              name
            }
            contact {
              id
            }
          }
        }
      }
    }
  `;

  let response: Response;

  try {
    response = await admin.graphql(query, {
      variables: { id: draftOrderId },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Shopify GraphQL error";

    logger.error(
      {
        event: "draft-order-budget-review.query-failed",
        draftOrderId,
        error,
        message,
      },
      "Draft order query failed",
    );

    throw new DraftOrderBudgetReviewError(
      "UPSTREAM_UNAVAILABLE",
      `Failed to query Shopify Draft Order: ${message}`,
    );
  }

  const json = (await response.json()) as DraftOrderGraphqlResponse;

  if (json.errors?.length) {
    throw new DraftOrderBudgetReviewError(
      "UPSTREAM_UNAVAILABLE",
      json.errors.map((error) => error.message).filter(Boolean).join("; ") ||
        "Shopify returned GraphQL errors while loading the draft order",
    );
  }

  return json.data?.draftOrder ?? null;
}

async function writeDraftOrderBudgetMetafields({
  admin,
  draftOrderId,
  decision,
  notificationStatus,
  notifiedAt,
}: {
  admin: AdminGraphqlClient;
  draftOrderId: string;
  decision: Awaited<ReturnType<BudgetDecisionService["resolve"]>>;
  notificationStatus: "not_required" | "sent" | "failed";
  notifiedAt: string | null;
}) {
  const metafields: Array<{
    ownerId: string;
    namespace: string;
    key: string;
    type: string;
    value: string;
  }> = [
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_status",
      type: "single_line_text_field",
      value: decision.status,
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_reason",
      type: "single_line_text_field",
      value: decision.reason,
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_source",
      type: "single_line_text_field",
      value: decision.source,
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_trigger_scope",
      type: "single_line_text_field",
      value: decision.triggerScope,
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_amount_exceeded_by",
      type: "number_decimal",
      value: String(decision.amountExceededBy),
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_notification_status",
      type: "single_line_text_field",
      value: notificationStatus,
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_fallback_used",
      type: "boolean",
      value: String(decision.fallbackUsed),
    },
    {
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_config_resolution",
      type: "single_line_text_field",
      value: decision.configResolution,
    },
  ];

  if (decision.limitApplied != null) {
    metafields.push({
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_limit_applied",
      type: "number_decimal",
      value: String(decision.limitApplied),
    });
  }

  if (decision.remainingSnapshot != null) {
    metafields.push({
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_remaining_snapshot",
      type: "number_decimal",
      value: String(decision.remainingSnapshot),
    });
  }

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_customer_limit_applied",
    type: "number_decimal",
    value: String(decision.customerLimitApplied ?? 0),
  });

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_customer_remaining_snapshot",
    type: "number_decimal",
    value: String(decision.customerRemainingSnapshot ?? 0),
  });

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_customer_amount_exceeded_by",
    type: "number_decimal",
    value: String(decision.customerAmountExceededBy),
  });

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_company_limit_applied",
    type: "number_decimal",
    value: String(decision.companyLimitApplied ?? 0),
  });

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_company_remaining_snapshot",
    type: "number_decimal",
    value: String(decision.companyRemainingSnapshot ?? 0),
  });

  metafields.push({
    ownerId: draftOrderId,
    namespace: "custom",
    key: "budget_company_amount_exceeded_by",
    type: "number_decimal",
    value: String(decision.companyAmountExceededBy),
  });

  if (decision.approverEmail) {
    metafields.push({
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_approver_email_used",
      type: "single_line_text_field",
      value: decision.approverEmail,
    });
  }

  if (notifiedAt) {
    metafields.push({
      ownerId: draftOrderId,
      namespace: "custom",
      key: "budget_notified_at",
      type: "date_time",
      value: notifiedAt,
    });
  }

  const mutation = `#graphql
    mutation SetDraftOrderBudgetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          namespace
          key
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  let response: Response;

  try {
    response = await admin.graphql(mutation, {
      variables: { metafields },
    });
  } catch (error) {
    logger.error(
      {
        event: "draft-order-budget-review.metafields-set-failed",
        draftOrderId,
        error,
      },
      "Failed to write Draft Order budget metafields",
    );

    throw new DraftOrderBudgetReviewError(
      "UPSTREAM_UNAVAILABLE",
      "Failed to write Draft Order budget metafields",
    );
  }

  const json = (await response.json()) as MetafieldsSetResponse;

  if (json.errors?.length) {
    throw new DraftOrderBudgetReviewError(
      "UPSTREAM_UNAVAILABLE",
      json.errors.map((error) => error.message).filter(Boolean).join("; ") ||
        "Shopify returned GraphQL errors while writing draft order metafields",
    );
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new DraftOrderBudgetReviewError(
      "UPSTREAM_UNAVAILABLE",
      userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ") || "Failed to write draft order budget metafields",
    );
  }
}

function buildDraftOrderAdminUrl(shopDomain: string, draftOrderGid: string) {
  const storeHandle = shopDomain.replace(".myshopify.com", "");
  const numericId = extractNumericId(draftOrderGid);

  if (!storeHandle || !numericId) {
    return "";
  }

  return `https://admin.shopify.com/store/${storeHandle}/draft_orders/${numericId}`;
}

function extractNumericId(gid: string) {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? "";
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatDecimal(value: number) {
  return value.toFixed(2);
}

function buildApprovalEmailBody({
  draftOrderName,
  companyName,
  companyLocationName,
  orderTotal,
  currency,
  invoiceUrl,
  reason,
  triggerScope,
  customerCreditLimit,
  customerRemainingCredit,
  customerAmountExceededBy,
  companyCreditLimit,
  companyRemainingCredit,
  companyAmountExceededBy,
}: {
  draftOrderName: string;
  companyName: string;
  companyLocationName: string;
  orderTotal: string;
  currency: string;
  invoiceUrl: string;
  reason: string;
  triggerScope: "customer" | "company" | "both" | "none";
  customerCreditLimit: string;
  customerRemainingCredit: string;
  customerAmountExceededBy: string;
  companyCreditLimit: string;
  companyRemainingCredit: string;
  companyAmountExceededBy: string;
}) {
  const triggerLabel =
    triggerScope === "both"
      ? "Individual customer and company credit exceeded"
      : triggerScope === "customer"
        ? "Individual customer credit exceeded"
        : triggerScope === "company"
          ? "Company credit exceeded"
          : "No budget trigger";

  return [
    `An order has been created on www.centralcleaningsupplies.com.au which has exceeded your assigned credit limit.`,
    ``,
    `Draft order: ${draftOrderName}`,
    `Company: ${companyName}`,
    `Location: ${companyLocationName}`,
    `Order total: ${currency} ${orderTotal}`,
    `Triggered by: ${triggerLabel}`,
    `Reason: ${reason}`,
    `Customer credit limit: ${currency} ${customerCreditLimit}`,
    `Customer remaining credit: ${currency} ${customerRemainingCredit}`,
    `Customer amount exceeded by: ${currency} ${customerAmountExceededBy}`,
    `Company credit limit: ${currency} ${companyCreditLimit}`,
    `Company remaining credit: ${currency} ${companyRemainingCredit}`,
    `Company amount exceeded by: ${currency} ${companyAmountExceededBy}`,
    ``,
    invoiceUrl ? `Order Approval Link: ${invoiceUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
