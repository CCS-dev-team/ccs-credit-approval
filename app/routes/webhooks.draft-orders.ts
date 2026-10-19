import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger } from "../lib/logger.server";
import { processDraftOrderLifecycleNotification } from "../services/process-draft-order-lifecycle-notification.server";

type DraftOrderWebhookPayload =
  | {
      id?: number | string;
      admin_graphql_api_id?: string;
      name?: string | null;
      invoice_url?: string | null;
      purchase_order_number?: string | null;
      po_number?: string | null;
      note?: string | null;
      email?: string | null;
      customer?: {
        email?: string | null;
        display_name?: string | null;
      } | null;
      company_name?: string | null;
      company_location_name?: string | null;
      rejection_reason?: string | null;
    }
  | null
  | undefined;

type SupportedDraftOrderTopic =
  | "DRAFT_ORDERS_CREATE"
  | "DRAFT_ORDERS_UPDATE"
  | "DRAFT_ORDERS_DELETE";

type NotificationProcessorResult = {
  status: "sent" | "skipped" | "failed";
  reason: string;
  approverEmail?: string | null;
  creatorEmail?: string | null;
  lifecycleState?: string | null;
};

type DraftOrderWebhookProcessResult = {
  lifecycle: NotificationProcessorResult | null;
};

const SUPPORTED_TOPICS: ReadonlySet<string> = new Set([
  "DRAFT_ORDERS_CREATE",
  "DRAFT_ORDERS_UPDATE",
  "DRAFT_ORDERS_DELETE",
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (!shop) {
    logger.error(
      {
        event: "draft-order-notification.webhook.missing-shop",
        topic,
      },
      "Webhook received without shop domain",
    );

    return new Response("Missing shop domain", { status: 500 });
  }

  if (!admin) {
    logger.error(
      {
        event: "draft-order-notification.webhook.missing-admin",
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
        event: "draft-order-notification.webhook.ignored-topic",
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
        event: "draft-order-notification.webhook.missing-draft-id",
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
      event: "draft-order-notification.webhook.received",
      topic,
      shop,
      draftOrderId,
      hasPayloadName: Boolean(getPayloadString(payload, "name")),
      hasPayloadInvoiceUrl: Boolean(getPayloadString(payload, "invoice_url")),
      hasPayloadCustomerEmail: Boolean(getPayloadCustomerEmail(payload)),
      hasPayloadRejectionReason: Boolean(
        getPayloadString(payload, "rejection_reason"),
      ),
    },
    "Received draft order webhook for lifecycle notification processing",
  );

  try {
    const result = await processDraftOrderWebhook({
      topic,
      shop,
      draftOrderId,
      payload,
      graphql: (query, options) => admin.graphql(query, options),
    });

    logger.info(
      {
        event: "draft-order-notification.webhook.processed",
        topic,
        shop,
        draftOrderId,
        lifecycleStatus: result.lifecycle?.status ?? null,
        lifecycleReason: result.lifecycle?.reason ?? null,
        lifecycleCreatorEmail: result.lifecycle?.creatorEmail ?? null,
        lifecycleState: result.lifecycle?.lifecycleState ?? null,
      },
      "Draft order webhook processed",
    );

    if (result.lifecycle?.status === "failed") {
      return new Response(`Processing failed: ${result.lifecycle.reason}`, {
        status: 500,
      });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error(
      {
        event: "draft-order-notification.webhook.exception",
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
  payload,
  graphql,
}: {
  topic: SupportedDraftOrderTopic;
  shop: string;
  draftOrderId: string;
  payload: DraftOrderWebhookPayload;
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): Promise<DraftOrderWebhookProcessResult> {
  logger.info(
    {
      event: "draft-order-notification.webhook.dispatch",
      topic,
      shop,
      draftOrderId,
    },
    "Dispatching draft order webhook to lifecycle notification processor",
  );

  switch (topic) {
    case "DRAFT_ORDERS_CREATE": {
      logger.info(
        {
          event: "draft-order-notification.webhook.create-ignored",
          topic,
          shop,
          draftOrderId,
        },
        "Ignoring DRAFT_ORDERS_CREATE because submission notifications are handled by Flow",
      );

      return {
        lifecycle: null,
      };
    }

    case "DRAFT_ORDERS_UPDATE": {
      const lifecycle = await processDraftOrderLifecycleNotification({
        shop,
        draftOrderId,
        graphql,
        notificationContext: buildLifecycleNotificationContext(topic, payload),
      });

      return {
        lifecycle,
      };
    }

    case "DRAFT_ORDERS_DELETE": {
      const lifecycle = await processDraftOrderLifecycleNotification({
        shop,
        draftOrderId,
        graphql,
        notificationContext: buildLifecycleNotificationContext(topic, payload),
      });

      return {
        lifecycle,
      };
    }
  }
}

function buildLifecycleNotificationContext(
  topic: SupportedDraftOrderTopic,
  payload: DraftOrderWebhookPayload,
) {
  if (!payload || typeof payload !== "object") {
    return topic === "DRAFT_ORDERS_DELETE"
      ? { workflowApprovalState: "rejected" as const }
      : undefined;
  }

  const creatorEmail = getPayloadCustomerEmail(payload);
  const invoiceUrl = getPayloadString(payload, "invoice_url");
  const draftOrderName = getPayloadString(payload, "name");
  const purchaseOrderNumber =
    getPayloadString(payload, "purchase_order_number") ||
    getPayloadString(payload, "po_number");
  const companyName = getPayloadString(payload, "company_name");
  const companyLocationName = getPayloadString(payload, "company_location_name");
  const rejectionReason = getPayloadString(payload, "rejection_reason");

  if (topic === "DRAFT_ORDERS_DELETE") {
    return {
      workflowApprovalState: "rejected" as const,
      creatorEmail,
      invoiceUrl,
      draftOrderName,
      purchaseOrderNumber,
      companyName,
      companyLocationName,
      rejectionReason,
    };
  }

  return {
    creatorEmail,
    invoiceUrl,
    draftOrderName,
    purchaseOrderNumber,
    companyName,
    companyLocationName,
    rejectionReason,
  };
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

function getPayloadString(
  payload: DraftOrderWebhookPayload,
  key: keyof NonNullable<DraftOrderWebhookPayload>,
): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getPayloadCustomerEmail(
  payload: DraftOrderWebhookPayload,
): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const directEmail =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim().toLowerCase()
      : undefined;

  if (directEmail) {
    return directEmail;
  }

  const customerEmail =
    payload.customer &&
    typeof payload.customer === "object" &&
    typeof payload.customer.email === "string" &&
    payload.customer.email.trim()
      ? payload.customer.email.trim().toLowerCase()
      : undefined;

  return customerEmail;
}

