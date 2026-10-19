import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { processSubmissionNotification } from "../services/process-submission-notification.server";

type DraftOrderWebhookPayload =
  | {
      id?: number | string;
      admin_graphql_api_id?: string;
    }
  | null
  | undefined;

type SupportedDraftOrderTopic = "DRAFT_ORDERS_CREATE" | "DRAFT_ORDERS_UPDATE";

const SUPPORTED_TOPICS: ReadonlySet<string> = new Set([
  "DRAFT_ORDERS_CREATE",
  "DRAFT_ORDERS_UPDATE",
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (!shop) {
    logger.error(
      {
        event: "submission-notification.webhook.missing-shop",
        topic,
      },
      "Webhook received without shop domain",
    );

    return new Response("Missing shop domain", { status: 500 });
  }

  if (!admin) {
    logger.error(
      {
        event: "submission-notification.webhook.missing-admin",
        topic,
        shop,
      },
      "Webhook received without admin client",
    );

    return new Response("Missing admin client", { status: 500 });
  }

  if (!isSupportedDraftOrderTopic(topic)) {
    logger.info(
      {
        event: "submission-notification.webhook.ignored-topic",
        topic,
        shop,
      },
      "Ignoring unsupported webhook topic",
    );

    return new Response(null, { status: 200 });
  }

  const draftOrderId = extractDraftOrderId(payload);

  if (!draftOrderId) {
    logger.error(
      {
        event: "submission-notification.webhook.missing-draft-id",
        topic,
        shop,
        payload,
      },
      "Webhook payload did not contain a draft order id",
    );

    return new Response("Missing draft order id", { status: 400 });
  }

  logger.info(
    {
      event: "submission-notification.webhook.received",
      topic,
      shop,
      draftOrderId,
    },
    "Received draft order webhook for notification processing",
  );

  try {
    const result = await processDraftOrderWebhook({
      topic,
      shop,
      draftOrderId,
      graphql: (query, options) => admin.graphql(query, options),
    });

    logger.info(
      {
        event: "submission-notification.webhook.processed",
        topic,
        shop,
        draftOrderId,
        status: result.status,
        reason: result.reason,
        approverEmail: result.approverEmail,
      },
      "Draft order webhook processed",
    );

    if (result.status === "failed") {
      return new Response(`Processing failed: ${result.reason}`, {
        status: 500,
      });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error(
      {
        event: "submission-notification.webhook.exception",
        topic,
        shop,
        draftOrderId,
        error,
      },
      "Unhandled exception while processing draft order webhook",
    );

    return new Response("Webhook processing error", { status: 500 });
  }
};

async function processDraftOrderWebhook({
  topic,
  shop,
  draftOrderId,
  graphql,
}: {
  topic: SupportedDraftOrderTopic;
  shop: string;
  draftOrderId: string;
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}) {
  logger.info(
    {
      event: "submission-notification.webhook.dispatch",
      topic,
      shop,
      draftOrderId,
    },
    "Dispatching draft order webhook to submission notification processor",
  );

  switch (topic) {
    case "DRAFT_ORDERS_CREATE":
    case "DRAFT_ORDERS_UPDATE":
      return processSubmissionNotification({
        shop,
        draftOrderId,
        graphql,
      });
  }
}

function isSupportedDraftOrderTopic(
  topic: string,
): topic is SupportedDraftOrderTopic {
  return SUPPORTED_TOPICS.has(topic);
}

function extractDraftOrderId(payload: DraftOrderWebhookPayload): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.admin_graphql_api_id) {
    return String(payload.admin_graphql_api_id);
  }

  if (payload.id !== null && payload.id !== undefined) {
    return String(payload.id);
  }

  return null;
}

