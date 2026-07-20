import { logger } from "../lib/logger.server";

export type AdminGraphqlExecutor = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface MarkDraftSubmittedForApprovalInput {
  shop: string;
  draftOrderId: string;
  graphql: AdminGraphqlExecutor;
}

export interface MarkDraftSubmittedForApprovalResult {
  ok: boolean;
  shop: string;
  draftOrderId: string;
  approvalState: "submitted";
  error?: string;
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
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

const MARK_DRAFT_SUBMITTED_MUTATION = `#graphql
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
}: MarkDraftSubmittedForApprovalInput): Promise<MarkDraftSubmittedForApprovalResult> {
  const ownerId = toGid("DraftOrder", draftOrderId);

  logger.info(
    {
      event: "submission-notification.mark-submitted.start",
      shop,
      draftOrderId: ownerId,
    },
    "Marking draft order as submitted for approval",
  );

  const metafields = [
    {
      ownerId,
      namespace: "custom",
      key: "approval_state",
      type: "single_line_text_field",
      value: "submitted",
    },
  ];

  let response: Response;

  try {
    response = await graphql(MARK_DRAFT_SUBMITTED_MUTATION, {
      variables: { metafields },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GraphQL request error";

    logger.error(
      {
        event: "submission-notification.mark-submitted.request-failed",
        shop,
        draftOrderId: ownerId,
        error,
        message,
      },
      "Failed to send GraphQL request to mark draft as submitted",
    );

    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
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
        event: "submission-notification.mark-submitted.invalid-json",
        shop,
        draftOrderId: ownerId,
        statusCode: response.status,
        error,
        message,
      },
      "Failed to parse GraphQL response while marking draft as submitted",
    );

    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      error: message,
    };
  }

  if (!response.ok) {
    const graphqlErrors = json.errors?.map((e) => e.message).join("; ");
    const message =
      graphqlErrors || `Shopify GraphQL returned HTTP ${response.status}`;

    logger.error(
      {
        event: "submission-notification.mark-submitted.http-failed",
        shop,
        draftOrderId: ownerId,
        statusCode: response.status,
        errors: json.errors ?? null,
      },
      "Shopify GraphQL returned a non-2xx response while marking draft as submitted",
    );

    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      error: message,
    };
  }

  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.graphql-errors",
        shop,
        draftOrderId: ownerId,
        errors: json.errors,
      },
      "Shopify GraphQL returned errors while marking draft as submitted",
    );

    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      error: message,
    };
  }

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];

  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");

    logger.error(
      {
        event: "submission-notification.mark-submitted.user-errors",
        shop,
        draftOrderId: ownerId,
        userErrors,
      },
      "metafieldsSet returned user errors while marking draft as submitted",
    );

    return {
      ok: false,
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
      error: message,
    };
  }

  logger.info(
    {
      event: "submission-notification.mark-submitted.success",
      shop,
      draftOrderId: ownerId,
      approvalState: "submitted",
    },
    "Draft order marked as submitted for approval",
  );

  return {
    ok: true,
    shop,
    draftOrderId: ownerId,
    approvalState: "submitted",
  };
}

function toGid(resource: string, value: string): string {
  if (value.startsWith("gid://")) {
    return value;
  }

  return `gid://shopify/${resource}/${value}`;
}
