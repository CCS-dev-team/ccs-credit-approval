import { logger } from "../lib/logger.server";

export type AdminGraphqlExecutor = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export type DraftApprovalReason = "standard" | "credit_limit_exceeded";
export type DraftSubmissionChannel = "cart" | "credit-limit";

export interface MarkDraftSubmittedForApprovalInput {
  shop: string;
  draftOrderId: string;
  graphql: AdminGraphqlExecutor;
  approvalReason: DraftApprovalReason;
  approverEmail?: string | null;
  purchaseOrderNumber?: string | null;
  submissionChannel?: DraftSubmissionChannel | null;
  submissionType?: string | null;
}

export interface MarkDraftSubmittedForApprovalResult {
  ok: boolean;
  shop: string;
  draftOrderId: string;
  approvalState: "submitted";
  approvalReason: DraftApprovalReason;
  error?: string;
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type DraftAttribute = {
  key?: string | null;
  value?: string | null;
};

type DraftTagNode = {
  tags?: string[] | null;
};

type DraftSubmissionStateQueryResponse = {
  draftOrder?: {
    id?: string | null;
    name?: string | null;
    tags?: string[] | null;
    customAttributes?: DraftAttribute[] | null;
  } | null;
};

type DraftOrderUpdateMutationResponse = {
  draftOrderUpdate?: {
    draftOrder?: {
      id?: string | null;
      name?: string | null;
      tags?: string[] | null;
      customAttributes?: DraftAttribute[] | null;
    } | null;
    userErrors?: Array<{
      field?: string[] | null;
      message: string;
      code?: string | null;
    }> | null;
  } | null;
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

const WORKFLOW_STATE_KEY = "Workflow State";
const APPROVAL_STATE_KEY = "Approval State";
const APPROVAL_REASON_KEY = "Approval Reason";
const APPROVER_EMAIL_KEY = "Approver Email";
const SUBMISSION_CHANNEL_KEY = "Submission Channel";
const ORDER_SUBMISSION_TYPE_KEY = "Order Submission Type";
const PURCHASE_ORDER_NUMBER_KEY = "Purchase Order Number";

const MARK_DRAFT_SUBMITTED_QUERY = `#graphql
  query GetDraftSubmissionState($id: ID!) {
    draftOrder(id: $id) {
      id
      name
      tags
      customAttributes {
        key
        value
      }
    }
  }
`;

const UPDATE_DRAFT_SUBMISSION_STATE_MUTATION = `#graphql
  mutation UpdateDraftSubmissionState($id: ID!, $input: DraftOrderInput!) {
    draftOrderUpdate(id: $id, input: $input) {
      draftOrder {
        id
        name
        tags
        customAttributes {
          key
          value
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const MARK_DRAFT_SUBMITTED_METAFIELDS_MUTATION = `#graphql
  mutation MarkDraftSubmittedForApproval($metafields: [MetafieldsSetInput!]!) {
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

export async function markDraftSubmittedForApproval({
  shop,
  draftOrderId,
  graphql,
  approvalReason,
  approverEmail,
  purchaseOrderNumber,
  submissionChannel,
  submissionType,
}: MarkDraftSubmittedForApprovalInput): Promise<MarkDraftSubmittedForApprovalResult> {
  const ownerId = toGid("DraftOrder", draftOrderId);

  const resolvedApproverEmail = normalizeOptionalString(approverEmail);
  const resolvedPurchaseOrderNumber = normalizeOptionalString(purchaseOrderNumber);
  const resolvedSubmissionChannel =
    submissionChannel ?? inferSubmissionChannel(approvalReason);
  const resolvedSubmissionType =
    normalizeOptionalString(submissionType) ??
    inferSubmissionType(approvalReason);

  logger.info(
    {
      event: "submission-notification.mark-submitted.start",
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      approvalReason,
      submissionChannel: resolvedSubmissionChannel,
      submissionType: resolvedSubmissionType,
      hasApproverEmail: Boolean(resolvedApproverEmail),
      hasPurchaseOrderNumber: Boolean(resolvedPurchaseOrderNumber),
    },
    "Marking draft order as submitted for approval",
  );

  const currentDraft = await getCurrentDraftSubmissionState({
    ownerId,
    shop,
    graphql,
    approvalReason,
  });

  if (!currentDraft.ok) {
    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      approvalReason,
      error: currentDraft.error,
    };
  }

  const mergedCustomAttributes = mergeCustomAttributes(
    currentDraft.customAttributes,
    [
      { key: WORKFLOW_STATE_KEY, value: "submitted" },
      { key: APPROVAL_STATE_KEY, value: "submitted" },
      { key: APPROVAL_REASON_KEY, value: approvalReason },
      { key: SUBMISSION_CHANNEL_KEY, value: resolvedSubmissionChannel },
      { key: ORDER_SUBMISSION_TYPE_KEY, value: resolvedSubmissionType },
      resolvedApproverEmail
        ? { key: APPROVER_EMAIL_KEY, value: resolvedApproverEmail }
        : null,
      resolvedPurchaseOrderNumber
        ? { key: PURCHASE_ORDER_NUMBER_KEY, value: resolvedPurchaseOrderNumber }
        : null,
    ],
  );

  const mergedTags = mergeTags(currentDraft.tags, [
    "awaiting-approver-review",
    approvalReason === "credit_limit_exceeded" ? "credit-limit-exceeded" : null,
  ]);

  const updateResult = await updateDraftSubmissionState({
    shop,
    ownerId,
    graphql,
    approvalReason,
    customAttributes: mergedCustomAttributes,
    tags: mergedTags,
  });

  if (!updateResult.ok) {
    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      approvalReason,
      error: updateResult.error,
    };
  }

  const metafieldsResult = await setSubmissionMetafields({
    shop,
    ownerId,
    graphql,
    approvalReason,
  });

  if (!metafieldsResult.ok) {
    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      approvalReason,
      error: metafieldsResult.error,
    };
  }

  logger.info(
    {
      event: "submission-notification.mark-submitted.success",
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      approvalReason,
      submissionChannel: resolvedSubmissionChannel,
      submissionType: resolvedSubmissionType,
      hasApproverEmail: Boolean(resolvedApproverEmail),
    },
    "Draft order marked as submitted for approval",
  );

  return {
    ok: true,
    shop,
    draftOrderId: ownerId,
    approvalState: "submitted",
    approvalReason,
  };
}

async function getCurrentDraftSubmissionState({
  ownerId,
  shop,
  graphql,
  approvalReason,
}: {
  ownerId: string;
  shop: string;
  graphql: AdminGraphqlExecutor;
  approvalReason: DraftApprovalReason;
}): Promise<
  | {
      ok: true;
      tags: string[];
      customAttributes: DraftAttribute[];
    }
  | {
      ok: false;
      error: string;
    }
> {
  let response: Response;

  try {
    response = await graphql(MARK_DRAFT_SUBMITTED_QUERY, {
      variables: { id: ownerId },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GraphQL request error";

    logger.error(
      {
        event: "submission-notification.mark-submitted.load-draft.request-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        error,
        message,
      },
      "Failed to load draft order before marking as submitted",
    );

    return {
      ok: false,
      error: message,
    };
  }

  let json: GraphqlResponse<DraftSubmissionStateQueryResponse>;

  try {
    json = (await response.json()) as GraphqlResponse<DraftSubmissionStateQueryResponse>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON response";

    logger.error(
      {
        event: "submission-notification.mark-submitted.load-draft.invalid-json",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        error,
        message,
      },
      "Failed to parse GraphQL response while loading draft order",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (!response.ok) {
    const graphqlErrors = json.errors?.map((e) => e.message).join("; ");
    const message =
      graphqlErrors || `Shopify GraphQL returned HTTP ${response.status}`;

    logger.error(
      {
        event: "submission-notification.mark-submitted.load-draft.http-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        errors: json.errors ?? null,
      },
      "Shopify GraphQL returned a non-2xx response while loading draft order",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.load-draft.graphql-errors",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors while loading draft order",
    );

    return {
      ok: false,
      error: message,
    };
  }

  const draftOrder = json.data?.draftOrder;

  if (!draftOrder?.id) {
    logger.error(
      {
        event: "submission-notification.mark-submitted.load-draft.not-found",
        shop,
        draftOrderId: ownerId,
        approvalReason,
      },
      "Draft order could not be loaded before submission marking",
    );

    return {
      ok: false,
      error: "Draft order not found",
    };
  }

  return {
    ok: true,
    tags: (draftOrder.tags ?? []).filter(Boolean),
    customAttributes: (draftOrder.customAttributes ?? []).filter(Boolean),
  };
}

async function updateDraftSubmissionState({
  shop,
  ownerId,
  graphql,
  approvalReason,
  customAttributes,
  tags,
}: {
  shop: string;
  ownerId: string;
  graphql: AdminGraphqlExecutor;
  approvalReason: DraftApprovalReason;
  customAttributes: Array<{ key: string; value: string }>;
  tags: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: Response;

  try {
    response = await graphql(UPDATE_DRAFT_SUBMISSION_STATE_MUTATION, {
      variables: {
        id: ownerId,
        input: {
          customAttributes,
          tags,
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GraphQL request error";

    logger.error(
      {
        event: "submission-notification.mark-submitted.update-draft.request-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        error,
        message,
      },
      "Failed to send GraphQL request to update draft submission state",
    );

    return {
      ok: false,
      error: message,
    };
  }

  let json: GraphqlResponse<DraftOrderUpdateMutationResponse>;

  try {
    json = (await response.json()) as GraphqlResponse<DraftOrderUpdateMutationResponse>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON response";

    logger.error(
      {
        event: "submission-notification.mark-submitted.update-draft.invalid-json",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        error,
        message,
      },
      "Failed to parse GraphQL response while updating draft submission state",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (!response.ok) {
    const graphqlErrors = json.errors?.map((e) => e.message).join("; ");
    const message =
      graphqlErrors || `Shopify GraphQL returned HTTP ${response.status}`;

    logger.error(
      {
        event: "submission-notification.mark-submitted.update-draft.http-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        errors: json.errors ?? null,
      },
      "Shopify GraphQL returned a non-2xx response while updating draft submission state",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.update-draft.graphql-errors",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors while updating draft submission state",
    );

    return {
      ok: false,
      error: message,
    };
  }

  const userErrors = json.data?.draftOrderUpdate?.userErrors ?? [];

  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.update-draft.user-errors",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        userErrors,
      },
      "draftOrderUpdate returned user errors while marking draft as submitted",
    );

    return {
      ok: false,
      error: message,
    };
  }

  return { ok: true };
}

async function setSubmissionMetafields({
  shop,
  ownerId,
  graphql,
  approvalReason,
}: {
  shop: string;
  ownerId: string;
  graphql: AdminGraphqlExecutor;
  approvalReason: DraftApprovalReason;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const metafields = [
    {
      ownerId,
      namespace: "custom",
      key: "approval_state",
      type: "single_line_text_field",
      value: "submitted",
    },
    {
      ownerId,
      namespace: "custom",
      key: "approval_reason",
      type: "single_line_text_field",
      value: approvalReason,
    },
  ];

  let response: Response;

  try {
    response = await graphql(MARK_DRAFT_SUBMITTED_METAFIELDS_MUTATION, {
      variables: { metafields },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GraphQL request error";

    logger.error(
      {
        event: "submission-notification.mark-submitted.metafields.request-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        error,
        message,
      },
      "Failed to send GraphQL request to set submission metafields",
    );

    return {
      ok: false,
      error: message,
    };
  }

  let json: GraphqlResponse<MetafieldsSetMutationResponse>;

  try {
    json = (await response.json()) as GraphqlResponse<MetafieldsSetMutationResponse>;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid JSON response";

    logger.error(
      {
        event: "submission-notification.mark-submitted.metafields.invalid-json",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        error,
        message,
      },
      "Failed to parse GraphQL response while setting submission metafields",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (!response.ok) {
    const graphqlErrors = json.errors?.map((e) => e.message).join("; ");
    const message =
      graphqlErrors || `Shopify GraphQL returned HTTP ${response.status}`;

    logger.error(
      {
        event: "submission-notification.mark-submitted.metafields.http-failed",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        statusCode: response.status,
        errors: json.errors ?? null,
      },
      "Shopify GraphQL returned a non-2xx response while setting submission metafields",
    );

    return {
      ok: false,
      error: message,
    };
  }

  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.metafields.graphql-errors",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors while setting submission metafields",
    );

    return {
      ok: false,
      error: message,
    };
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];

  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.metafields.user-errors",
        shop,
        draftOrderId: ownerId,
        approvalReason,
        userErrors,
      },
      "metafieldsSet returned user errors while marking draft as submitted",
    );

    return {
      ok: false,
      error: message,
    };
  }

  return { ok: true };
}

function mergeCustomAttributes(
  existing: DraftAttribute[],
  updates: Array<{ key: string; value: string } | null>,
): Array<{ key: string; value: string }> {
  const map = new Map<string, { key: string; value: string }>();

  for (const item of existing) {
    const key = normalizeOptionalString(item?.key);
    const value = normalizeOptionalString(item?.value);

    if (!key || !value) continue;

    map.set(key.toLowerCase(), { key, value });
  }

  for (const item of updates) {
    if (!item) continue;

    const key = normalizeOptionalString(item.key);
    const value = normalizeOptionalString(item.value);

    if (!key || !value) continue;

    map.set(key.toLowerCase(), { key, value });
  }

  return Array.from(map.values());
}

function mergeTags(
  existing: string[],
  additions: Array<string | null | undefined>,
): string[] {
  const values = new Map<string, string>();

  for (const tag of existing) {
    const normalized = normalizeOptionalString(tag);
    if (!normalized) continue;
    values.set(normalized.toLowerCase(), normalized);
  }

  for (const tag of additions) {
    const normalized = normalizeOptionalString(tag);
    if (!normalized) continue;
    values.set(normalized.toLowerCase(), normalized);
  }

  return Array.from(values.values());
}

function inferSubmissionChannel(
  approvalReason: DraftApprovalReason,
): DraftSubmissionChannel {
  if (approvalReason === "credit_limit_exceeded") {
    return "credit-limit";
  }

  return "cart";
}

function inferSubmissionType(approvalReason: DraftApprovalReason): string {
  if (approvalReason === "credit_limit_exceeded") {
    return "Credit Limit Approval";
  }

  return "Draft Order Request";
}

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toGid(resource: string, value: string): string {
  if (value.startsWith("gid://")) {
    return value;
  }

  return `gid://shopify/${resource}/${value}`;
}
