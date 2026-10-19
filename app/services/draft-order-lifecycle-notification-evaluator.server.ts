import { approvalEmailService } from "./approval-email.server";
import { logger } from "../lib/logger.server";
import type {
  DraftOrderLifecycleContext,
  DraftOrderLifecycleState,
  MarkDraftOrderLifecycleNotifiedInput,
} from "./submission-notification-provider.server";

export type DraftOrderLifecycleNotificationStatus =
  | "sent"
  | "skipped"
  | "failed";

export type DraftOrderLifecycleNotificationReason =
  | "sent"
  | "draft_not_found"
  | "no_creator_email"
  | "no_lifecycle_state"
  | "already_notified"
  | "not_relevant"
  | "email_failed"
  | "mark_notified_failed";

export interface DraftOrderLifecycleNotificationContextInput {
  approvalReason?: string | null;
  workflowApprovalState?: string | null;
  creatorEmail?: string | null;
  approverEmail?: string | null;
  reviewUrl?: string | null;
  invoiceUrl?: string | null;
  purchaseOrderNumber?: string | null;
  draftOrderName?: string | null;
  companyName?: string | null;
  companyLocationName?: string | null;
  rejectionReason?: string | null;
}

export interface EvaluateDraftOrderLifecycleNotificationInput {
  shop: string;
  draftOrderId: string;
  notificationContext?: DraftOrderLifecycleNotificationContextInput;
}

export interface DraftOrderLifecycleNotificationDataProvider {
  getDraftOrderLifecycleContext(
    shop: string,
    draftOrderId: string,
  ): Promise<DraftOrderLifecycleContext | null>;

  markDraftOrderLifecycleNotified(
    input: MarkDraftOrderLifecycleNotifiedInput,
  ): Promise<void>;
}

export interface DraftOrderLifecycleNotificationResult {
  status: DraftOrderLifecycleNotificationStatus;
  reason: DraftOrderLifecycleNotificationReason;
  shop: string;
  draftOrderId: string;
  creatorEmail: string | null;
  lifecycleState: DraftOrderLifecycleState | null;
}

export class DraftOrderLifecycleNotificationEvaluatorService {
  constructor(private provider: DraftOrderLifecycleNotificationDataProvider) {}

  async evaluate(
    input: EvaluateDraftOrderLifecycleNotificationInput,
  ): Promise<DraftOrderLifecycleNotificationResult> {
    logger.info(
      {
        event: "draft-order-lifecycle.evaluate.start",
        shop: input.shop,
        draftOrderId: input.draftOrderId,
        hasNotificationContext: Boolean(input.notificationContext),
        hasWorkflowApprovalState: Boolean(
          normalizeOptionalString(input.notificationContext?.workflowApprovalState),
        ),
        hasCreatorEmail: Boolean(
          normalizeEmail(input.notificationContext?.creatorEmail),
        ),
        hasInvoiceUrl: Boolean(
          normalizeOptionalString(input.notificationContext?.invoiceUrl),
        ),
        hasRejectionReason: Boolean(
          normalizeOptionalString(input.notificationContext?.rejectionReason),
        ),
      },
      "Starting draft order lifecycle notification evaluation",
    );

    const fetchedDraft = await this.provider.getDraftOrderLifecycleContext(
      input.shop,
      input.draftOrderId,
    );

    const fallbackDraft =
      fetchedDraft ??
      createSyntheticDraftContext({
        shop: input.shop,
        draftOrderId: input.draftOrderId,
        context: input.notificationContext,
      });

    if (!fallbackDraft) {
      logger.info(
        {
          event: "draft-order-lifecycle.evaluate.skipped",
          shop: input.shop,
          draftOrderId: input.draftOrderId,
          reason: "draft_not_found",
        },
        "Draft order lifecycle notification skipped: draft not found and no fallback context available",
      );

      return {
        status: "skipped",
        reason: "draft_not_found",
        shop: input.shop,
        draftOrderId: input.draftOrderId,
        creatorEmail: null,
        lifecycleState: null,
      };
    }

    const usingSnapshotOnly = !fetchedDraft;

    const mergedDraft = mergeDraftWithNotificationContext(
      fallbackDraft,
      input.notificationContext,
    );

    const creatorEmail = normalizeEmail(mergedDraft.customerEmail);

    if (!creatorEmail) {
      logger.info(
        {
          event: "draft-order-lifecycle.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "no_creator_email",
          usingSnapshotOnly,
        },
        "Draft order lifecycle notification skipped: no creator email",
      );

      return {
        status: "skipped",
        reason: "no_creator_email",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail: null,
        lifecycleState: null,
      };
    }

    const lifecycleState = resolveLifecycleState(mergedDraft);

    if (!lifecycleState) {
      logger.info(
        {
          event: "draft-order-lifecycle.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "no_lifecycle_state",
          workflowApprovalState: mergedDraft.workflowApprovalState ?? null,
          status: mergedDraft.status ?? null,
          rejectionReason: mergedDraft.rejectionReason ?? null,
          usingSnapshotOnly,
        },
        "Draft order lifecycle notification skipped: no lifecycle state detected",
      );

      return {
        status: "skipped",
        reason: "no_lifecycle_state",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail,
        lifecycleState: null,
      };
    }

    if (!isRelevantLifecycleDraft(mergedDraft, lifecycleState)) {
      logger.info(
        {
          event: "draft-order-lifecycle.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "not_relevant",
          lifecycleState,
          status: mergedDraft.status ?? null,
          isOpen: mergedDraft.isOpen ?? null,
          usingSnapshotOnly,
        },
        "Draft order lifecycle notification skipped: draft is not relevant",
      );

      return {
        status: "skipped",
        reason: "not_relevant",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail,
        lifecycleState,
      };
    }

    const existingNotifiedAt = usingSnapshotOnly
      ? null
      : getLifecycleNotifiedAt(mergedDraft, lifecycleState);

    if (existingNotifiedAt) {
      logger.info(
        {
          event: "draft-order-lifecycle.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "already_notified",
          lifecycleState,
          alreadyNotifiedAt: existingNotifiedAt,
        },
        "Draft order lifecycle notification skipped: already notified",
      );

      return {
        status: "skipped",
        reason: "already_notified",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail,
        lifecycleState,
      };
    }

    const subject = buildLifecycleSubject(mergedDraft, lifecycleState);
    const text = buildLifecycleTextBody(mergedDraft, lifecycleState);
    const html = buildLifecycleHtmlBody(mergedDraft, lifecycleState);

    const sendResult = await approvalEmailService.send({
      to: creatorEmail,
      subject,
      text,
      html,
    });

    if (!sendResult.ok) {
      logger.error(
        {
          event: "draft-order-lifecycle.email.failed",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          creatorEmail,
          lifecycleState,
          usingSnapshotOnly,
          statusCode: sendResult.statusCode,
          error: sendResult.error,
          hasInvoiceUrl: Boolean(resolveInvoiceUrl(mergedDraft)),
        },
        "Draft order lifecycle notification email failed",
      );

      return {
        status: "failed",
        reason: "email_failed",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail,
        lifecycleState,
      };
    }

    const notifiedAt = new Date().toISOString();

    if (!usingSnapshotOnly) {
      try {
        await this.provider.markDraftOrderLifecycleNotified({
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          lifecycleState,
          notifiedAt,
        });
      } catch (error) {
        logger.error(
          {
            event: "draft-order-lifecycle.mark-notified.failed",
            shop: mergedDraft.shop,
            draftOrderId: mergedDraft.id,
            creatorEmail,
            lifecycleState,
            notifiedAt,
            error,
          },
          "Draft order lifecycle email sent but failed to mark lifecycle state as notified",
        );

        return {
          status: "failed",
          reason: "mark_notified_failed",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          creatorEmail,
          lifecycleState,
        };
      }
    } else {
      logger.warn(
        {
          event: "draft-order-lifecycle.snapshot-mode.sent",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          creatorEmail,
          lifecycleState,
          notifiedAt,
        },
        "Draft order lifecycle notification sent using snapshot-only context; no metafield writeback possible",
      );
    }

    logger.info(
      {
        event: "draft-order-lifecycle.email.sent",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        creatorEmail,
        lifecycleState,
        usingSnapshotOnly,
        notifiedAt,
        statusCode: sendResult.statusCode,
        hasInvoiceUrl: Boolean(resolveInvoiceUrl(mergedDraft)),
      },
      "Draft order lifecycle notification email sent successfully",
    );

    return {
      status: "sent",
      reason: "sent",
      shop: mergedDraft.shop,
      draftOrderId: mergedDraft.id,
      creatorEmail,
      lifecycleState,
    };
  }
}

function createSyntheticDraftContext({
  shop,
  draftOrderId,
  context,
}: {
  shop: string;
  draftOrderId: string;
  context?: DraftOrderLifecycleNotificationContextInput;
}): DraftOrderLifecycleContext | null {
  if (!context) {
    return null;
  }

  const creatorEmail = normalizeEmail(context.creatorEmail);
  const workflowApprovalState = normalizeOptionalString(
    context.workflowApprovalState,
  );
  const rejectionReason = normalizeOptionalString(context.rejectionReason);

  if (!creatorEmail && !workflowApprovalState && !rejectionReason) {
    return null;
  }

  const reviewUrl = normalizeOptionalString(context.reviewUrl);
  const invoiceUrl = normalizeOptionalString(context.invoiceUrl);

  return {
    id: draftOrderId,
    shop,
    name: normalizeOptionalString(context.draftOrderName) || draftOrderId,
    createdAt: null,
    updatedAt: null,
    status:
      workflowApprovalState === "rejected"
        ? "deleted"
        : workflowApprovalState ?? null,
    isOpen: workflowApprovalState === "rejected" ? false : null,

    totalAmount: null,
    currencyCode: null,
    poNumber: normalizeOptionalString(context.purchaseOrderNumber),

    customerName: null,
    customerEmail: creatorEmail,

    companyName: normalizeOptionalString(context.companyName),
    companyLocationId: null,
    companyLocationName: normalizeOptionalString(context.companyLocationName),
    approverEmail: normalizeEmail(context.approverEmail),

    workflowApprovalState,
    submissionNotifiedAt: null,
    creatorEditedNotifiedAt: null,
    creatorApprovedNotifiedAt: null,
    creatorRejectedNotifiedAt: null,
    rejectionReason,

    approvalReason: normalizeOptionalString(context.approvalReason),

    budgetStatus: null,
    budgetReason: null,
    budgetTriggerScope: null,

    customerCreditLimit: null,
    customerRemainingCredit: null,
    customerAmountExceededBy: null,

    companyCreditLimit: null,
    companyRemainingCredit: null,
    companyAmountExceededBy: null,

    approvalLink: reviewUrl || invoiceUrl || null,
    reviewUrl,
    invoiceUrl,
  };
}

function mergeDraftWithNotificationContext(
  draft: DraftOrderLifecycleContext,
  context?: DraftOrderLifecycleNotificationContextInput,
): DraftOrderLifecycleContext {
  const creatorEmail = normalizeEmail(context?.creatorEmail);
  const approverEmail = normalizeEmail(context?.approverEmail);
  const reviewUrl = normalizeOptionalString(context?.reviewUrl);
  const invoiceUrl = normalizeOptionalString(context?.invoiceUrl);

  return {
    ...draft,
    name: normalizeOptionalString(context?.draftOrderName) || draft.name,
    poNumber:
      normalizeOptionalString(context?.purchaseOrderNumber) || draft.poNumber,
    companyName:
      normalizeOptionalString(context?.companyName) || draft.companyName,
    companyLocationName:
      normalizeOptionalString(context?.companyLocationName) ||
      draft.companyLocationName,
    customerEmail: creatorEmail || draft.customerEmail,
    approverEmail: approverEmail || draft.approverEmail,
    workflowApprovalState:
      normalizeOptionalString(context?.workflowApprovalState) ||
      draft.workflowApprovalState,
    reviewUrl: reviewUrl || draft.reviewUrl,
    invoiceUrl: invoiceUrl || draft.invoiceUrl,
    approvalLink: reviewUrl || invoiceUrl || draft.approvalLink,
    rejectionReason:
      normalizeOptionalString(context?.rejectionReason) || draft.rejectionReason,
    approvalReason:
      normalizeOptionalString(context?.approvalReason) || draft.approvalReason,
  };
}

function normalizeEmail(value?: string | null): string | null {
  const email = value?.trim().toLowerCase();
  return email ? email : null;
}

function normalizeState(value?: string | null): string | null {
  const state = value?.trim().toLowerCase();
  return state ? state : null;
}

function normalizeOptionalString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveLifecycleState(
  draft: DraftOrderLifecycleContext,
): DraftOrderLifecycleState | null {
  const workflowState = normalizeState(draft.workflowApprovalState);

  if (workflowState === "edited") {
    return "edited";
  }

  if (workflowState === "approved") {
    return "approved";
  }

  if (workflowState === "rejected") {
    return "rejected";
  }

  if (draft.rejectionReason) {
    return "rejected";
  }

  const status = normalizeState(draft.status);

  if (status && ["completed", "complete", "converted"].includes(status)) {
    return "approved";
  }

  return null;
}

function isRelevantLifecycleDraft(
  draft: DraftOrderLifecycleContext,
  lifecycleState: DraftOrderLifecycleState,
): boolean {
  const status = normalizeState(draft.status);

  if (lifecycleState === "approved") {
    return true;
  }

  if (lifecycleState === "rejected") {
    return true;
  }

  if (lifecycleState === "edited") {
    if (draft.isOpen === false) {
      return false;
    }

    if (
      status &&
      [
        "closed",
        "completed",
        "complete",
        "converted",
        "cancelled",
        "canceled",
        "archived",
        "deleted",
      ].includes(status)
    ) {
      return false;
    }
  }

  return true;
}

function getLifecycleNotifiedAt(
  draft: DraftOrderLifecycleContext,
  lifecycleState: DraftOrderLifecycleState,
): string | null {
  switch (lifecycleState) {
    case "edited":
      return normalizeOptionalString(draft.creatorEditedNotifiedAt);
    case "approved":
      return normalizeOptionalString(draft.creatorApprovedNotifiedAt);
    case "rejected":
      return normalizeOptionalString(draft.creatorRejectedNotifiedAt);
    default:
      return null;
  }
}

function buildLifecycleSubject(
  draft: DraftOrderLifecycleContext,
  lifecycleState: DraftOrderLifecycleState,
): string {
  const draftName = draft.name?.trim() || draft.id;

  switch (lifecycleState) {
    case "edited":
      return `Draft updated: ${draftName}`;
    case "approved":
      return `Draft approved: ${draftName}`;
    case "rejected":
      return `Draft rejected: ${draftName}`;
    default:
      return `Draft update: ${draftName}`;
  }
}

function buildLifecycleTextBody(
  draft: DraftOrderLifecycleContext,
  lifecycleState: DraftOrderLifecycleState,
): string {
  switch (lifecycleState) {
    case "edited":
      return buildEditedTextBody(draft);
    case "approved":
      return buildApprovedTextBody(draft);
    case "rejected":
      return buildRejectedTextBody(draft);
    default:
      return buildEditedTextBody(draft);
  }
}

function buildLifecycleHtmlBody(
  draft: DraftOrderLifecycleContext,
  lifecycleState: DraftOrderLifecycleState,
): string {
  switch (lifecycleState) {
    case "edited":
      return buildEditedHtmlBody(draft);
    case "approved":
      return buildApprovedHtmlBody(draft);
    case "rejected":
      return buildRejectedHtmlBody(draft);
    default:
      return buildEditedHtmlBody(draft);
  }
}

function buildEditedTextBody(draft: DraftOrderLifecycleContext): string {
  const invoiceUrl = resolveInvoiceUrl(draft);

  const lines: string[] = [
    "Your draft order has been updated.",
    "Please review the latest changes.",
    "",
    `Company: ${draft.companyName || "N/A"}`,
    `Location: ${draft.companyLocationName || "N/A"}`,
    `Draft order: ${draft.name || draft.id}`,
    `Updated at: ${formatDateTime(draft.updatedAt || draft.createdAt)}`,
    `Buyer: ${draft.customerName || "N/A"}`,
    `Buyer email: ${draft.customerEmail || "N/A"}`,
    `PO number: ${draft.poNumber || "N/A"}`,
    `Total: ${formatMoney(draft.totalAmount, draft.currencyCode)}`,
  ];

  if (invoiceUrl) {
    lines.push("", `Complete your order: ${invoiceUrl}`);
  }

  return lines.join("\n");
}

function buildApprovedTextBody(draft: DraftOrderLifecycleContext): string {
  const lines: string[] = [
    "Your draft order has been approved.",
    "",
    `Company: ${draft.companyName || "N/A"}`,
    `Location: ${draft.companyLocationName || "N/A"}`,
    `Draft order: ${draft.name || draft.id}`,
    `Approved at: ${formatDateTime(draft.updatedAt || draft.createdAt)}`,
    `Buyer: ${draft.customerName || "N/A"}`,
    `Buyer email: ${draft.customerEmail || "N/A"}`,
    `PO number: ${draft.poNumber || "N/A"}`,
    `Total: ${formatMoney(draft.totalAmount, draft.currencyCode)}`,
  ];

  return lines.join("\n");
}

function buildRejectedTextBody(draft: DraftOrderLifecycleContext): string {
  const lines: string[] = [
    "Your draft order has been rejected.",
    "Please review the details below.",
    "",
    `Company: ${draft.companyName || "N/A"}`,
    `Location: ${draft.companyLocationName || "N/A"}`,
    `Draft order: ${draft.name || draft.id}`,
    `Updated at: ${formatDateTime(draft.updatedAt || draft.createdAt)}`,
    `Buyer: ${draft.customerName || "N/A"}`,
    `Buyer email: ${draft.customerEmail || "N/A"}`,
    `PO number: ${draft.poNumber || "N/A"}`,
    `Total: ${formatMoney(draft.totalAmount, draft.currencyCode)}`,
  ];

  if (draft.rejectionReason) {
    lines.push(`Reason: ${draft.rejectionReason}`);
  }

  return lines.join("\n");
}

function buildEditedHtmlBody(draft: DraftOrderLifecycleContext): string {
  const invoiceUrl = resolveInvoiceUrl(draft);

  const rows: Array<[string, string]> = [
    ["Company", draft.companyName || "N/A"],
    ["Location", draft.companyLocationName || "N/A"],
    ["Draft order", draft.name || draft.id],
    ["Updated at", formatDateTime(draft.updatedAt || draft.createdAt)],
    ["Buyer", draft.customerName || "N/A"],
    ["Buyer email", draft.customerEmail || "N/A"],
    ["PO number", draft.poNumber || "N/A"],
    ["Total", formatMoney(draft.totalAmount, draft.currencyCode)],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${escapeHtml(value)}</td>
        </tr>
      `,
    )
    .join("");

  const cta = invoiceUrl
    ? `
      <p style="margin:24px 0 12px;">
        <a
          href="${escapeHtml(invoiceUrl)}"
          style="display:inline-block;padding:12px 18px;background:#166534;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;"
        >
          Complete your order
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">
        If the button does not work, copy and paste this URL into your browser:<br />${escapeHtml(invoiceUrl)}
      </p>
    `
    : "";

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p>Your draft order has been updated.</p>
      <p>Please review the latest changes.</p>

      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        ${tableRows}
      </table>

      ${cta}
    </div>
  `.trim();
}

function buildApprovedHtmlBody(draft: DraftOrderLifecycleContext): string {
  const rows: Array<[string, string]> = [
    ["Company", draft.companyName || "N/A"],
    ["Location", draft.companyLocationName || "N/A"],
    ["Draft order", draft.name || draft.id],
    ["Approved at", formatDateTime(draft.updatedAt || draft.createdAt)],
    ["Buyer", draft.customerName || "N/A"],
    ["Buyer email", draft.customerEmail || "N/A"],
    ["PO number", draft.poNumber || "N/A"],
    ["Total", formatMoney(draft.totalAmount, draft.currencyCode)],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${escapeHtml(value)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p>Your draft order has been approved.</p>

      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        ${tableRows}
      </table>
    </div>
  `.trim();
}

function buildRejectedHtmlBody(draft: DraftOrderLifecycleContext): string {
  const rows: Array<[string, string]> = [
    ["Company", draft.companyName || "N/A"],
    ["Location", draft.companyLocationName || "N/A"],
    ["Draft order", draft.name || draft.id],
    ["Updated at", formatDateTime(draft.updatedAt || draft.createdAt)],
    ["Buyer", draft.customerName || "N/A"],
    ["Buyer email", draft.customerEmail || "N/A"],
    ["PO number", draft.poNumber || "N/A"],
    ["Total", formatMoney(draft.totalAmount, draft.currencyCode)],
  ];

  if (draft.rejectionReason) {
    rows.push(["Reason", draft.rejectionReason]);
  }

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px;border:1px solid #e5e7eb;">${escapeHtml(value)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p style="font-weight:700;color:#b91c1c;">Your draft order has been rejected.</p>
      <p>Please review the details below.</p>

      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        ${tableRows}
      </table>
    </div>
  `.trim();
}

function resolveInvoiceUrl(draft: DraftOrderLifecycleContext): string | null {
  return (
    normalizeOptionalString(draft.invoiceUrl) ||
    normalizeOptionalString(draft.approvalLink)
  );
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatMoney(
  amount?: number | null,
  currencyCode?: string | null,
): string {
  if (amount === null || amount === undefined) {
    return "N/A";
  }

  const currency = currencyCode?.trim() || "USD";

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
