import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { config } from "../lib/config.server";
import { logger } from "../lib/logger.server";
import {
  DraftOrderBudgetReviewError,
  reviewDraftOrderBudget,
} from "../services/draft-order-budget-review.server";
import { unauthenticated } from "../shopify.server";

type FlowDraftOrderCreatedRequestBody = {
  draftOrderId?: string;
  draftOrderName?: string | null;
  shopDomain?: string;
};

type ErrorResponse = {
  ok: false;
  errorCode:
    | "METHOD_NOT_ALLOWED"
    | "UNAUTHORIZED"
    | "BAD_REQUEST"
    | "DRAFT_NOT_FOUND"
    | "UPSTREAM_UNAVAILABLE"
    | "NOTIFICATION_FAILED"
    | "INTERNAL_ERROR";
  message: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  logger.warn(
    {
      event: "flow-draft-order-created.loader-not-allowed",
      method: request.method,
      url: request.url,
    },
    "GET is not supported for Flow draft order created endpoint",
  );

  return Response.json<ErrorResponse>(
    {
      ok: false,
      errorCode: "METHOD_NOT_ALLOWED",
      message: "Use POST for this endpoint",
    },
    { status: 405 },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method.toUpperCase() !== "POST") {
    return Response.json<ErrorResponse>(
      {
        ok: false,
        errorCode: "METHOD_NOT_ALLOWED",
        message: "Use POST for this endpoint",
      },
      { status: 405 },
    );
  }

  const authorizationHeader = request.headers.get("authorization");

  if (!isAuthorizedBearerToken(authorizationHeader, config.FLOW_SHARED_SECRET)) {
    return Response.json<ErrorResponse>(
      {
        ok: false,
        errorCode: "UNAUTHORIZED",
        message: "Invalid or missing authorization token",
      },
      { status: 401 },
    );
  }

  let body: FlowDraftOrderCreatedRequestBody;

  try {
    const parsed = (await request.json()) as FlowDraftOrderCreatedRequestBody;
    body = parsed ?? {};
  } catch (error) {
    logger.warn(
      {
        event: "flow-draft-order-created.invalid-json",
        error,
      },
      "Invalid JSON body received for Flow draft order created endpoint",
    );

    return Response.json<ErrorResponse>(
      {
        ok: false,
        errorCode: "BAD_REQUEST",
        message: "Request body must be valid JSON",
      },
      { status: 400 },
    );
  }

  const draftOrderId = (body.draftOrderId ?? "").trim();
  const draftOrderName = body.draftOrderName?.trim() || null;
  const headerShopDomain =
    request.headers.get("x-shopify-shop-domain")?.trim() || "";
  const shopDomain = (body.shopDomain ?? headerShopDomain).trim();

  if (!draftOrderId || !shopDomain) {
    return Response.json<ErrorResponse>(
      {
        ok: false,
        errorCode: "BAD_REQUEST",
        message: "draftOrderId and shopDomain are required",
      },
      { status: 400 },
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shopDomain);

    const result = await reviewDraftOrderBudget({
      admin,
      shopDomain,
      draftOrderId,
      draftOrderName,
    });

    if (result.notificationStatus === "failed") {
      logger.warn(
        {
          event: "flow-draft-order-created.notification-failed",
          shopDomain,
          draftOrderId,
          draftOrderName,
          budgetStatus: result.budgetStatus,
          budgetReason: result.budgetReason,
          approverEmail: result.approverEmail,
          notify: result.notify,
          emailSent: result.emailSent,
          notificationStatus: result.notificationStatus,
        },
        "Draft order review completed but notification failed; returning 503 for Flow retry",
      );

           return Response.json(
        {
          ...result,
          ok: false,
          errorCode: "NOTIFICATION_FAILED",
          message: "Approval notification failed to send",
        },
        { status: 503 },
      );

    }

    logger.info(
      {
        event: "flow-draft-order-created.success",
        shopDomain,
        draftOrderId,
        draftOrderName,
        budgetStatus: result.budgetStatus,
        budgetReason: result.budgetReason,
        approverEmail: result.approverEmail,
        notify: result.notify,
        emailSent: result.emailSent,
        notificationStatus: result.notificationStatus,
      },
      "Draft order created Flow request processed successfully",
    );

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof DraftOrderBudgetReviewError) {
      logger.error(
        {
          event: "flow-draft-order-created.known-error",
          shopDomain,
          draftOrderId,
          draftOrderName,
          code: error.code,
          message: error.message,
        },
        "Draft order created Flow request failed with known error",
      );

      return Response.json<ErrorResponse>(
        {
          ok: false,
          errorCode: error.code,
          message: error.message,
        },
        { status: mapErrorCodeToHttpStatus(error.code) },
      );
    }

   logger.error(
      {
        event: "flow-draft-order-created.unhandled-error",
        shopDomain,
        draftOrderId,
        draftOrderName,
        error: serializeUnknownError(error),
      },
      "Draft order created Flow request failed with unhandled error",
    );

    return Response.json<ErrorResponse>(
      {
        ok: false,
        errorCode: "INTERNAL_ERROR",
        message: "Unexpected application error",
      },
      { status: 500 },
    );
  }
}

function isAuthorizedBearerToken(
  authorizationHeader: string | null,
  expectedSecret: string,
) {
  if (!authorizationHeader) return false;

  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;

  const providedSecret = authorizationHeader.slice(prefix.length);

  const providedBuffer = Buffer.from(providedSecret);
  const expectedBuffer = Buffer.from(expectedSecret);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function mapErrorCodeToHttpStatus(
  code: DraftOrderBudgetReviewError["code"],
): number {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "DRAFT_NOT_FOUND":
      return 404;
    case "UPSTREAM_UNAVAILABLE":
      return 503;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 500;
  }
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
