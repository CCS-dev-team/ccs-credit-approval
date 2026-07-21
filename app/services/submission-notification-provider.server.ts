import { logger } from "../lib/logger.server";
import type {
  DraftSubmissionContext,
  MarkSubmissionNotifiedInput,
  SubmissionNotificationDataProvider,
} from "./submission-notification-evaluator.server";

export type AdminGraphqlExecutor = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type DraftContextQueryResponse = {
  draftOrder: null | {
    id: string;
    name: string;
    totalPrice?: string | number | null;
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
    metafieldApprovalState?: {
      value?: string | null;
    } | null;
    metafieldSubmissionNotifiedAt?: {
      value?: string | null;
    } | null;
    metafieldApprovalReason?: {
      value?: string | null;
    } | null;
    metafieldPurchaseOrderNumber?: {
      value?: string | null;
    } | null;
    metafieldBudgetStatus?: {
      value?: string | null;
    } | null;
    metafieldBudgetReason?: {
      value?: string | null;
    } | null;
    metafieldBudgetTriggerScope?: {
      value?: string | null;
    } | null;
    metafieldBudgetCustomerLimitApplied?: {
      value?: string | null;
    } | null;
    metafieldBudgetCustomerRemainingSnapshot?: {
      value?: string | null;
    } | null;
    metafieldBudgetCustomerAmountExceededBy?: {
      value?: string | null;
    } | null;
    metafieldBudgetCompanyLimitApplied?: {
      value?: string | null;
    } | null;
    metafieldBudgetCompanyRemainingSnapshot?: {
      value?: string | null;
    } | null;
    metafieldBudgetCompanyAmountExceededBy?: {
      value?: string | null;
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
  };
};

type CompanyLocationApproverQueryResponse = {
  node: null | {
    __typename?: string | null;
    id?: string | null;
    metafield?: {
      value?: string | null;
    } | null;
  };
};

type MetafieldsSetMutationResponse = {
  metafieldsSet: {
    metafields?: Array<{
      id?: string | null;
      namespace?: string | null;
      key?: string | null;
      value?: string | null;
    }> | null;
    userErrors?: Array<{
      field?: string[] | null;
      message: string;
      code?: string | null;
    }> | null;
  };
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
    }
  }
`;

const COMPANY_LOCATION_APPROVER_QUERY = `#graphql
  query CompanyLocationApprover($id: ID!) {
    node(id: $id) {
      __typename
      ... on CompanyLocation {
        id
        metafield(namespace: "custom", key: "workflow_approver_email") {
          value
        }
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MarkSubmissionNotified($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
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

export class ShopifySubmissionNotificationDataProvider
  implements SubmissionNotificationDataProvider
{
  constructor(private graphql: AdminGraphqlExecutor) {}

  async getDraftSubmissionContext(
    shop: string,
    draftOrderId: string,
  ): Promise<DraftSubmissionContext | null> {
    const draftId = toGid("DraftOrder", draftOrderId);

    const response = await graphqlRequest<DraftContextQueryResponse>(
      this.graphql,
      DRAFT_SUBMISSION_CONTEXT_QUERY,
      { id: draftId },
      {
        shop,
        operation: "draft_submission_context",
        draftOrderId: draftId,
      },
    );

    const draft = response.draftOrder;

    if (!draft) {
      logger.info(
        {
          event: "submission-notification.provider.draft.not-found",
          shop,
          draftOrderId: draftId,
        },
        "Draft order not found for submission notification context",
      );
      return null;
    }

    const companyLocationId =
      draft.purchasingEntity?.__typename === "PurchasingCompany"
        ? normalizeString(draft.purchasingEntity.companyLocation?.id)
        : null;

    let approverEmail: string | null = null;

    if (companyLocationId) {
      approverEmail = await this.getCompanyLocationApproverEmail(
        shop,
        companyLocationId,
      );
    }

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
      shop,
      name: draft.name,
      createdAt: normalizeString(draft.createdAt),

      status: null,
      isOpen: null,

      totalAmount: parseMoneyAmount(draft.totalPrice),
      currencyCode: normalizeString(draft.presentmentCurrencyCode),
      poNumber,

      customerName: normalizeString(draft.customer?.displayName),
      customerEmail: normalizeEmail(draft.customer?.email),

      companyName:
        draft.purchasingEntity?.__typename === "PurchasingCompany"
          ? normalizeString(draft.purchasingEntity.company?.name)
          : null,
      companyLocationId,
      companyLocationName:
        draft.purchasingEntity?.__typename === "PurchasingCompany"
          ? normalizeString(draft.purchasingEntity.companyLocation?.name)
          : null,
      approverEmail: normalizeEmail(approverEmail),

      workflowApprovalState: normalizeString(
        draft.metafieldApprovalState?.value,
      ),
      submissionNotifiedAt: normalizeString(
        draft.metafieldSubmissionNotifiedAt?.value,
      ),
      approvalReason: normalizeApprovalReason(
        draft.metafieldApprovalReason?.value,
      ),

      budgetStatus: normalizeString(draft.metafieldBudgetStatus?.value),
      budgetReason: normalizeString(draft.metafieldBudgetReason?.value),
      budgetTriggerScope: normalizeBudgetTriggerScope(
        draft.metafieldBudgetTriggerScope?.value,
      ),

      customerCreditLimit: parseMoneyAmount(
        draft.metafieldBudgetCustomerLimitApplied?.value,
      ),
      customerRemainingCredit: parseMoneyAmount(
        draft.metafieldBudgetCustomerRemainingSnapshot?.value,
      ),
      customerAmountExceededBy: parseMoneyAmount(
        draft.metafieldBudgetCustomerAmountExceededBy?.value,
      ),

      companyCreditLimit: parseMoneyAmount(
        draft.metafieldBudgetCompanyLimitApplied?.value,
      ),
      companyRemainingCredit: parseMoneyAmount(
        draft.metafieldBudgetCompanyRemainingSnapshot?.value,
      ),
      companyAmountExceededBy: parseMoneyAmount(
        draft.metafieldBudgetCompanyAmountExceededBy?.value,
      ),

      approvalLink: normalizeString(draft.invoiceUrl),
    };
  }

  async markSubmissionNotified(
    input: MarkSubmissionNotifiedInput,
  ): Promise<void> {
    const ownerId = toGid("DraftOrder", input.draftOrderId);

    const metafields: Array<Record<string, unknown>> = [
      {
        ownerId,
        namespace: "custom",
        key: "submission_notified_at",
        type: "date_time",
        value: input.notifiedAt,
      },
    ];

    if (input.approvalState) {
      metafields.push({
        ownerId,
        namespace: "custom",
        key: "approval_state",
        type: "single_line_text_field",
        value: input.approvalState,
      });
    }

    const response = await graphqlRequest<MetafieldsSetMutationResponse>(
      this.graphql,
      METAFIELDS_SET_MUTATION,
      { metafields },
      {
        shop: input.shop,
        operation: "mark_submission_notified",
        draftOrderId: ownerId,
      },
    );

    const userErrors = response.metafieldsSet?.userErrors ?? [];

    if (userErrors.length > 0) {
      const message = userErrors
        .map((error) => error.message)
        .filter(Boolean)
        .join("; ");

      throw new Error(
        `Failed to mark draft as submission notified: ${message}`,
      );
    }

    logger.info(
      {
        event: "submission-notification.provider.mark-notified.success",
        shop: input.shop,
        draftOrderId: ownerId,
        notifiedAt: input.notifiedAt,
        approvalState: input.approvalState ?? null,
      },
      "Draft order marked as submission notified",
    );
  }

  private async getCompanyLocationApproverEmail(
    shop: string,
    companyLocationId: string,
  ): Promise<string | null> {
    const locationId = toGid("CompanyLocation", companyLocationId);

    const response = await graphqlRequest<CompanyLocationApproverQueryResponse>(
      this.graphql,
      COMPANY_LOCATION_APPROVER_QUERY,
      { id: locationId },
      {
        shop,
        operation: "company_location_approver",
        companyLocationId: locationId,
      },
    );

    if (response.node?.__typename !== "CompanyLocation") {
      return null;
    }

    return normalizeEmail(response.node.metafield?.value);
  }
}

async function graphqlRequest<T>(
  graphql: AdminGraphqlExecutor,
  query: string,
  variables: Record<string, unknown>,
  logContext: Record<string, unknown>,
): Promise<T> {
  let response: Response;

  try {
    response = await graphql(query, { variables });
  } catch (error) {
    logger.error(
      {
        event: "submission-notification.provider.graphql.request-failed",
        ...logContext,
        error,
      },
      "Shopify GraphQL request failed",
    );
    throw error;
  }

  let json: GraphqlResponse<T>;

  try {
    json = (await response.json()) as GraphqlResponse<T>;
  } catch (error) {
    logger.error(
      {
        event: "submission-notification.provider.graphql.invalid-json",
        ...logContext,
        status: response.status,
        error,
      },
      "Shopify GraphQL response could not be parsed as JSON",
    );
    throw error;
  }

  if (!response.ok) {
    logger.error(
      {
        event: "submission-notification.provider.graphql.http-failed",
        ...logContext,
        status: response.status,
        errors: json.errors ?? null,
      },
      "Shopify GraphQL returned a non-2xx response",
    );

    throw new Error(
      `Shopify GraphQL request failed with HTTP ${response.status}`,
    );
  }

  if (json.errors?.length) {
    const message = json.errors.map((error) => error.message).join("; ");

    logger.error(
      {
        event: "submission-notification.provider.graphql.errors",
        ...logContext,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors",
    );

    throw new Error(message);
  }

  if (!json.data) {
    logger.error(
      {
        event: "submission-notification.provider.graphql.missing-data",
        ...logContext,
      },
      "Shopify GraphQL response was missing data",
    );

    throw new Error("Shopify GraphQL response was missing data");
  }

  return json.data;
}

function toGid(resource: string, value: string): string {
  if (value.startsWith("gid://")) {
    return value;
  }

  return `gid://shopify/${resource}/${value}`;
}

function parseMoneyAmount(value?: string | number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeString(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeApprovalReason(
  value?: string | null,
): "standard" | "credit_limit_exceeded" | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "credit_limit_exceeded") {
    return "credit_limit_exceeded";
  }

  if (normalized === "standard") {
    return "standard";
  }

  return null;
}

function normalizeBudgetTriggerScope(
  value?: string | null,
): "customer" | "company" | "both" | "none" | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "customer") return "customer";
  if (normalized === "company") return "company";
  if (normalized === "both") return "both";
  if (normalized === "none") return "none";

  return null;
}

function resolvePurchaseOrderNumber(
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null,
): string | null {
  if (!customAttributes?.length) {
    return null;
  }

  const acceptedKeys = new Set([
    "purchase order number",
    "purchase order",
    "purchase order #",
    "po number",
    "po #",
    "po#",
    "po",
    "purchase_order_number",
    "po_number",
  ]);

  for (const attribute of customAttributes) {
    const key = normalizePurchaseOrderKey(attribute.key);
    const value = normalizeString(attribute.value);

    if (key && value && acceptedKeys.has(key)) {
      return value;
    }
  }

  return null;
}

function normalizePurchaseOrderKey(value?: string | null): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  return normalized
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}
