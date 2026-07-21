import { logger } from "../lib/logger.server";
import type { DraftApprovalReason } from "./mark-draft-submitted-for-approval.server";

type AdminGraphqlExecutor = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export type DraftSubmissionContext = {
  id: string;
  draftOrderId: string;
  name: string;
  draftOrderName: string;
  createdAt: string | null;
  invoiceUrl: string;
  orderTotal: string;
  currency: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  companyId: string | null;
  companyName: string;
  companyLocationId: string | null;
  companyLocationName: string;
  approvalState: string | null;
  submissionNotifiedAt: string | null;
  approvalReason: DraftApprovalReason | null;
  approverEmail: string;
  poNumber: string | null;
  budgetStatus: "within_limit" | "exceeded" | null;
  budgetReason: string | null;
  budgetTriggerScope: "customer" | "company" | "both" | "none";
  creditLimit: string;
  remainingCredit: string;
  amountExceededBy: string;
  customerCreditLimit: string;
  customerRemainingCredit: string;
  customerAmountExceededBy: string;
  companyCreditLimit: string;
  companyRemainingCredit: string;
  companyAmountExceededBy: string;
};

type GraphqlError = {
  message?: string;
};

type MetafieldValue = {
  value?: string | null;
} | null;

type DraftContextQueryResponse = {
  draftOrder?: {
    id: string;
    name?: string | null;
    totalPrice?: unknown;
    presentmentCurrencyCode?: string | null;
    invoiceUrl?: string | null;
    createdAt?: string | null;
    customAttributes?: Array<{
      key?: string | null;
      value?: string | null;
    }> | null;
    customer?: {
      id?: string | null;
      displayName?: string | null;
      email?: string | null;
    } | null;
    purchasingEntity?: {
      __typename?: string | null;
      company?: {
        id?: string | null;
        name?: string | null;
      } | null;
      companyLocation?: {
        id?: string | null;
        name?: string | null;
      } | null;
    } | null;
    metafieldApprovalState?: MetafieldValue;
    metafieldSubmissionNotifiedAt?: MetafieldValue;
    metafieldApprovalReason?: MetafieldValue;
    metafieldPurchaseOrderNumber?: MetafieldValue;
    metafieldBudgetStatus?: MetafieldValue;
    metafieldBudgetReason?: MetafieldValue;
    metafieldBudgetTriggerScope?: MetafieldValue;
    metafieldBudgetAmountExceededBy?: MetafieldValue;
    metafieldBudgetLimitApplied?: MetafieldValue;
    metafieldBudgetRemainingSnapshot?: MetafieldValue;
    metafieldBudgetCustomerLimitApplied?: MetafieldValue;
    metafieldBudgetCustomerRemainingSnapshot?: MetafieldValue;
    metafieldBudgetCustomerAmountExceededBy?: MetafieldValue;
    metafieldBudgetCompanyLimitApplied?: MetafieldValue;
    metafieldBudgetCompanyRemainingSnapshot?: MetafieldValue;
    metafieldBudgetCompanyAmountExceededBy?: MetafieldValue;
    metafieldBudgetApproverEmailUsed?: MetafieldValue;
  } | null;
};

type CompanyLocationApproverQueryResponse = {
  companyLocation?: {
    id?: string | null;
    name?: string | null;
    metafieldApproverEmail?: {
      value?: string | null;
    } | null;
  } | null;
};

type MetafieldsSetResponse = {
  metafieldsSet?: {
    metafields?: Array<{
      namespace?: string | null;
      key?: string | null;
      value?: string | null;
    }> | null;
    userErrors?: Array<{
      field?: string[] | null;
      message?: string | null;
      code?: string | null;
    }> | null;
  } | null;
};

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: GraphqlError[];
};

const DRAFT_SUBMISSION_CONTEXT_QUERY = `#graphql
  query DraftSubmissionNotificationContext($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      totalPrice
      presentmentCurrencyCode
      invoiceUrl
      createdAt
      customAttributes {
        key
        value
      }
      customer {
        id
        displayName
        email
      }
      purchasingEntity {
        __typename
        ... on PurchasingCompany {
          company {
            id
            name
          }
          companyLocation: location {
            id
            name
          }
        }
      }
      metafieldApprovalState: metafield(namespace: "custom", key: "approval_state") {
        value
      }
      metafieldSubmissionNotifiedAt: metafield(namespace: "custom", key: "submission_notified_at") {
        value
      }
      metafieldApprovalReason: metafield(namespace: "custom", key: "approval_reason") {
        value
      }
      metafieldPurchaseOrderNumber: metafield(namespace: "custom", key: "purchase_order_number") {
        value
      }
      metafieldBudgetStatus: metafield(namespace: "custom", key: "budget_status") {
        value
      }
      metafieldBudgetReason: metafield(namespace: "custom", key: "budget_reason") {
        value
      }
      metafieldBudgetTriggerScope: metafield(namespace: "custom", key: "budget_trigger_scope") {
        value
      }
      metafieldBudgetAmountExceededBy: metafield(namespace: "custom", key: "budget_amount_exceeded_by") {
        value
      }
      metafieldBudgetLimitApplied: metafield(namespace: "custom", key: "budget_limit_applied") {
        value
      }
      metafieldBudgetRemainingSnapshot: metafield(namespace: "custom", key: "budget_remaining_snapshot") {
        value
      }
      metafieldBudgetCustomerLimitApplied: metafield(namespace: "custom", key: "budget_customer_limit_applied") {
        value
      }
      metafieldBudgetCustomerRemainingSnapshot: metafield(namespace: "custom", key: "budget_customer_remaining_snapshot") {
        value
      }
      metafieldBudgetCustomerAmountExceededBy: metafield(namespace: "custom", key: "budget_customer_amount_exceeded_by") {
        value
      }
      metafieldBudgetCompanyLimitApplied: metafield(namespace: "custom", key: "budget_company_limit_applied") {
        value
      }
      metafieldBudgetCompanyRemainingSnapshot: metafield(namespace: "custom", key: "budget_company_remaining_snapshot") {
        value
      }
      metafieldBudgetCompanyAmountExceededBy: metafield(namespace: "custom", key: "budget_company_amount_exceeded_by") {
        value
      }
      metafieldBudgetApproverEmailUsed: metafield(namespace: "custom", key: "budget_approver_email_used") {
        value
      }
    }
  }
`;

const COMPANY_LOCATION_APPROVER_QUERY = `#graphql
  query CompanyLocationApproverEmail($id: ID!) {
    companyLocation(id: $id) {
      id
      name
      metafieldApproverEmail: metafield(namespace: "custom", key: "approver_email") {
        value
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation SubmissionNotificationMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
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

export class ShopifySubmissionNotificationDataProvider {
  async getDraftSubmissionContext({
    shop,
    draftOrderId,
    graphql,
  }: {
    shop: string;
    draftOrderId: string;
    graphql: AdminGraphqlExecutor;
  }): Promise<DraftSubmissionContext | null> {
    const draftId = toGid("DraftOrder", draftOrderId);

    const data = await executeGraphql<DraftContextQueryResponse>({
      shop,
      graphql,
      query: DRAFT_SUBMISSION_CONTEXT_QUERY,
      variables: { id: draftId },
      operationName: "DraftSubmissionNotificationContext",
      eventBase: "submission-notification.provider.draft-context",
    });

    const draft = data.draftOrder;

    if (!draft) {
      logger.warn(
        {
          event: "submission-notification.provider.draft-not-found",
          shop,
          draftOrderId: draftId,
        },
        "Draft order was not returned by Shopify",
      );
      return null;
    }

    const companyLocationId =
      normalizeString(draft.purchasingEntity?.companyLocation?.id) ?? null;

    const approverEmailFromBudgetMetafield =
      normalizeEmail(draft.metafieldBudgetApproverEmailUsed?.value) ?? null;

    const approverEmailFromCompanyLocation = companyLocationId
      ? await this.getCompanyLocationApproverEmail({
          shop,
          companyLocationId,
          graphql,
        })
      : null;

    const approverEmail =
      approverEmailFromBudgetMetafield ??
      approverEmailFromCompanyLocation ??
      "";

    const poNumber =
      normalizeString(draft.metafieldPurchaseOrderNumber?.value) ??
      resolvePurchaseOrderNumber(draft.customAttributes) ??
      null;

    logger.info(
      {
        event: "submission-notification.provider.po-resolution",
        shop,
        draftOrderId: draftId,
        metafieldPurchaseOrderNumber:
          draft.metafieldPurchaseOrderNumber?.value ?? null,
        customAttributes: draft.customAttributes ?? [],
        resolvedPoNumber: poNumber,
      },
      "Resolved purchase order number for submission notification",
    );

    return {
      id: draft.id,
      draftOrderId: draft.id,
      name: normalizeString(draft.name) ?? draft.id,
      draftOrderName: normalizeString(draft.name) ?? draft.id,
      createdAt: normalizeString(draft.createdAt) ?? null,
      invoiceUrl: normalizeString(draft.invoiceUrl) ?? "",
      orderTotal: formatMoneyAmount(draft.totalPrice),
      currency: normalizeString(draft.presentmentCurrencyCode) ?? "AUD",
      customerId: normalizeString(draft.customer?.id) ?? null,
      customerName: normalizeString(draft.customer?.displayName) ?? null,
      customerEmail: normalizeEmail(draft.customer?.email) ?? null,
      companyId: normalizeString(draft.purchasingEntity?.company?.id) ?? null,
      companyName: normalizeString(draft.purchasingEntity?.company?.name) ?? "",
      companyLocationId,
      companyLocationName:
        normalizeString(draft.purchasingEntity?.companyLocation?.name) ?? "",
      approvalState: normalizeString(draft.metafieldApprovalState?.value) ?? null,
      submissionNotifiedAt:
        normalizeString(draft.metafieldSubmissionNotifiedAt?.value) ?? null,
      approvalReason: normalizeApprovalReason(
        draft.metafieldApprovalReason?.value,
      ),
      approverEmail,
      poNumber,
      budgetStatus: normalizeBudgetStatus(draft.metafieldBudgetStatus?.value),
      budgetReason: normalizeString(draft.metafieldBudgetReason?.value) ?? null,
      budgetTriggerScope: normalizeBudgetTriggerScope(
        draft.metafieldBudgetTriggerScope?.value,
      ),
      creditLimit: formatMoneyAmount(draft.metafieldBudgetLimitApplied?.value),
      remainingCredit: formatMoneyAmount(
        draft.metafieldBudgetRemainingSnapshot?.value,
      ),
      amountExceededBy: formatMoneyAmount(
        draft.metafieldBudgetAmountExceededBy?.value,
      ),
      customerCreditLimit: formatMoneyAmount(
        draft.metafieldBudgetCustomerLimitApplied?.value,
      ),
      customerRemainingCredit: formatMoneyAmount(
        draft.metafieldBudgetCustomerRemainingSnapshot?.value,
      ),
      customerAmountExceededBy: formatMoneyAmount(
        draft.metafieldBudgetCustomerAmountExceededBy?.value,
      ),
      companyCreditLimit: formatMoneyAmount(
        draft.metafieldBudgetCompanyLimitApplied?.value,
      ),
      companyRemainingCredit: formatMoneyAmount(
        draft.metafieldBudgetCompanyRemainingSnapshot?.value,
      ),
      companyAmountExceededBy: formatMoneyAmount(
        draft.metafieldBudgetCompanyAmountExceededBy?.value,
      ),
    };
  }

  async markSubmissionNotified({
    shop,
    draftOrderId,
    graphql,
  }: {
    shop: string;
    draftOrderId: string;
    graphql: AdminGraphqlExecutor;
  }): Promise<{
    ok: boolean;
    approvalState?: "notified";
    submissionNotifiedAt?: string;
    error?: string;
  }> {
    const draftId = toGid("DraftOrder", draftOrderId);
    const submissionNotifiedAt = new Date().toISOString();

    const metafields = [
      {
        ownerId: draftId,
        namespace: "custom",
        key: "submission_notified_at",
        type: "date_time",
        value: submissionNotifiedAt,
      },
      {
        ownerId: draftId,
        namespace: "custom",
        key: "approval_state",
        type: "single_line_text_field",
        value: "notified",
      },
    ];

    const data = await executeGraphql<MetafieldsSetResponse>({
      shop,
      graphql,
      query: METAFIELDS_SET_MUTATION,
      variables: { metafields },
      operationName: "SubmissionNotificationMetafieldsSet",
      eventBase: "submission-notification.provider.mark-notified",
    });

    const userErrors = data.metafieldsSet?.userErrors ?? [];

    if (userErrors.length > 0) {
      const message =
        userErrors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ") || "Failed to write submission notification metafields";

      logger.error(
        {
          event: "submission-notification.provider.mark-notified.user-errors",
          shop,
          draftOrderId: draftId,
          userErrors,
        },
        "Shopify returned metafieldsSet user errors while marking submission notified",
      );

      return {
        ok: false,
        error: message,
      };
    }

    logger.info(
      {
        event: "submission-notification.provider.mark-notified.success",
        shop,
        draftOrderId: draftId,
        submissionNotifiedAt,
      },
      "Marked draft order submission as notified",
    );

    return {
      ok: true,
      approvalState: "notified",
      submissionNotifiedAt,
    };
  }

  async getCompanyLocationApproverEmail({
    shop,
    companyLocationId,
    graphql,
  }: {
    shop: string;
    companyLocationId: string;
    graphql: AdminGraphqlExecutor;
  }): Promise<string | null> {
    const locationId = toGid("CompanyLocation", companyLocationId);

    const data = await executeGraphql<CompanyLocationApproverQueryResponse>({
      shop,
      graphql,
      query: COMPANY_LOCATION_APPROVER_QUERY,
      variables: { id: locationId },
      operationName: "CompanyLocationApproverEmail",
      eventBase: "submission-notification.provider.company-location-approver",
    });

    return (
      normalizeEmail(data.companyLocation?.metafieldApproverEmail?.value) ?? null
    );
  }
}

async function executeGraphql<T>({
  shop,
  graphql,
  query,
  variables,
  operationName,
  eventBase,
}: {
  shop: string;
  graphql: AdminGraphqlExecutor;
  query: string;
  variables?: Record<string, unknown>;
  operationName: string;
  eventBase: string;
}): Promise<T> {
  let response: Response;

  try {
    response = await graphql(query, { variables });
  } catch (error) {
    logger.error(
      {
        event: `${eventBase}.request-failed`,
        shop,
        operationName,
        variables,
        error: serializeUnknownError(error),
      },
      "Shopify GraphQL request failed",
    );

    throw new Error(`${operationName} request failed`);
  }

  let json: GraphqlEnvelope<T>;

  try {
    json = (await response.json()) as GraphqlEnvelope<T>;
  } catch (error) {
    logger.error(
      {
        event: `${eventBase}.invalid-json`,
        shop,
        operationName,
        status: response.status,
        statusText: response.statusText,
        error: serializeUnknownError(error),
      },
      "Shopify GraphQL response was not valid JSON",
    );

    throw new Error(`${operationName} returned invalid JSON`);
  }

  if (!response.ok) {
    logger.error(
      {
        event: `${eventBase}.http-error`,
        shop,
        operationName,
        status: response.status,
        statusText: response.statusText,
        body: json,
      },
      "Shopify GraphQL returned a non-2xx response",
    );

    throw new Error(`${operationName} returned HTTP ${response.status}`);
  }

  if (json.errors?.length) {
    logger.error(
      {
        event: `${eventBase}.graphql-errors`,
        shop,
        operationName,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors",
    );

    throw new Error(
      json.errors.map((error) => error.message).filter(Boolean).join("; ") ||
        `${operationName} returned GraphQL errors`,
    );
  }

  return (json.data ?? {}) as T;
}

function toGid(resource: string, id: string) {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/${resource}/${id}`;
}

function formatMoneyAmount(value: unknown) {
  const amount = parseMoneyAmount(value);
  return amount.toFixed(2);
}

function parseMoneyAmount(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (
    value &&
    typeof value === "object" &&
    "amount" in value &&
    typeof (value as { amount?: unknown }).amount === "string"
  ) {
    const parsed = Number((value as { amount: string }).amount);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeString(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeApprovalReason(
  value: string | null | undefined,
): DraftApprovalReason | null {
  const normalized = normalizeString(value);

  if (normalized === "standard") return "standard";
  if (normalized === "credit_limit_exceeded") return "credit_limit_exceeded";

  return null;
}

function normalizeBudgetStatus(value: string | null | undefined) {
  const normalized = normalizeString(value);

  if (normalized === "within_limit") return "within_limit";
  if (normalized === "exceeded") return "exceeded";

  return null;
}

function normalizeBudgetTriggerScope(
  value: string | null | undefined,
): "customer" | "company" | "both" | "none" {
  const normalized = normalizeString(value);

  if (normalized === "customer") return "customer";
  if (normalized === "company") return "company";
  if (normalized === "both") return "both";

  return "none";
}

function resolvePurchaseOrderNumber(
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null,
) {
  if (!customAttributes?.length) {
    return null;
  }

  const acceptedKeys = new Set([
    "purchase order number",
    "purchase order",
    "po number",
    "po #",
    "po#",
    "po",
    "ponumber",
  ]);

  for (const attribute of customAttributes) {
    const key = normalizePurchaseOrderKey(attribute.key);
    if (!key || !acceptedKeys.has(key)) continue;

    const value = normalizeString(attribute.value);
    if (value) return value;
  }

  return null;
}

function normalizePurchaseOrderKey(value: string | null | undefined) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  return normalized
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function serializeUnknownError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    "statusText" in error
  ) {
    const responseLike = error as {
      status?: unknown;
      statusText?: unknown;
      data?: unknown;
      body?: unknown;
    };

    return {
      type: "response_like",
      status: responseLike.status,
      statusText: responseLike.statusText,
      data: responseLike.data ?? null,
      body: responseLike.body ?? null,
    };
  }

  return {
    type: typeof error,
    value: error,
  };
}
