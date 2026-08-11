import { approvalEmailService } from "./approval-email.server";
import { logger } from "../lib/logger.server";

export type SubmissionNotificationStatus = "sent" | "skipped" | "failed";

export type SubmissionNotificationReason =
  | "sent"
  | "draft_not_found"
  | "not_submitted"
  | "already_notified"
  | "no_company_location"
  | "no_approver_email"
  | "not_relevant"
  | "email_failed"
  | "mark_notified_failed";

export interface SubmissionNotificationContext {
  approvalReason?: string | null;
  approverEmail?: string | null;
  reviewUrl?: string | null;
  invoiceUrl?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  purchaseOrderNumber?: string | null;
  draftOrderName?: string | null;
  companyName?: string | null;
  companyLocationName?: string | null;
}

export interface EvaluateSubmissionNotificationInput {
  shop: string;
  draftOrderId: string;
  notificationContext?: SubmissionNotificationContext;
}

export interface DraftSubmissionContext {
  id: string;
  shop: string;
  name: string;
  createdAt?: string | null;
  status?: string | null;
  isOpen?: boolean | null;

  totalAmount?: number | null;
  currencyCode?: string | null;
  poNumber?: string | null;

  customerName?: string | null;
  customerEmail?: string | null;

  companyName?: string | null;
  companyLocationId?: string | null;
  companyLocationName?: string | null;
  approverEmail?: string | null;

  workflowApprovalState?: string | null;
  submissionNotifiedAt?: string | null;
  approvalReason?: "standard" | "credit_limit_exceeded" | null;

  budgetStatus?: string | null;
  budgetReason?: string | null;
  budgetTriggerScope?: string | null;

  customerCreditLimit?: number | null;
  customerRemainingCredit?: number | null;
  customerAmountExceededBy?: number | null;

  companyCreditLimit?: number | null;
  companyRemainingCredit?: number | null;
  companyAmountExceededBy?: number | null;

  approvalLink?: string | null;
  reviewUrl?: string | null;
  invoiceUrl?: string | null;
}

export interface MarkSubmissionNotifiedInput {
  shop: string;
  draftOrderId: string;
  notifiedAt: string;
  approvalState?: "notified";
}

export interface SubmissionNotificationDataProvider {
  getDraftSubmissionContext(
    shop: string,
    draftOrderId: string,
  ): Promise<DraftSubmissionContext | null>;

  markSubmissionNotified(
    input: MarkSubmissionNotifiedInput,
  ): Promise<void>;
}

export interface SubmissionNotificationResult {
  status: SubmissionNotificationStatus;
  reason: SubmissionNotificationReason;
  shop: string;
  draftOrderId: string;
  approverEmail: string | null;
}

export class SubmissionNotificationEvaluatorService {
  constructor(private provider: SubmissionNotificationDataProvider) {}

  async evaluate(
    input: EvaluateSubmissionNotificationInput,
  ): Promise<SubmissionNotificationResult> {
    logger.info(
      {
        event: "submission-notification.evaluate.start",
        shop: input.shop,
        draftOrderId: input.draftOrderId,
        hasNotificationContext: Boolean(input.notificationContext),
        hasReviewUrl: Boolean(normalizeOptionalString(input.notificationContext?.reviewUrl)),
        hasInvoiceUrl: Boolean(normalizeOptionalString(input.notificationContext?.invoiceUrl)),
        hasCustomSubject: Boolean(normalizeOptionalString(input.notificationContext?.emailSubject)),
        hasCustomBody: Boolean(normalizeOptionalString(input.notificationContext?.emailBody)),
      },
      "Starting submission notification evaluation",
    );

    const draft = await this.provider.getDraftSubmissionContext(
      input.shop,
      input.draftOrderId,
    );

    if (!draft) {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: input.shop,
          draftOrderId: input.draftOrderId,
          reason: "draft_not_found",
        },
        "Submission notification skipped: draft not found",
      );

      return {
        status: "skipped",
        reason: "draft_not_found",
        shop: input.shop,
        draftOrderId: input.draftOrderId,
        approverEmail: null,
      };
    }

    const mergedDraft = mergeDraftWithNotificationContext(
      draft,
      input.notificationContext,
    );

    const approvalState = normalizeState(mergedDraft.workflowApprovalState);

    if (approvalState !== "submitted") {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "not_submitted",
          workflowApprovalState: mergedDraft.workflowApprovalState ?? null,
        },
        "Submission notification skipped: draft is not submitted",
      );

      return {
        status: "skipped",
        reason: "not_submitted",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail: normalizeEmail(mergedDraft.approverEmail),
      };
    }

    if (mergedDraft.submissionNotifiedAt) {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "already_notified",
          submissionNotifiedAt: mergedDraft.submissionNotifiedAt,
        },
        "Submission notification skipped: already notified",
      );

      return {
        status: "skipped",
        reason: "already_notified",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail: normalizeEmail(mergedDraft.approverEmail),
      };
    }

    if (!mergedDraft.companyLocationId) {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "no_company_location",
        },
        "Submission notification skipped: no company location",
      );

      return {
        status: "skipped",
        reason: "no_company_location",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail: null,
      };
    }

    const approverEmail = normalizeEmail(mergedDraft.approverEmail);

    if (!approverEmail) {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "no_approver_email",
          companyLocationId: mergedDraft.companyLocationId,
        },
        "Submission notification skipped: no approver email",
      );

      return {
        status: "skipped",
        reason: "no_approver_email",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail: null,
      };
    }

    if (!isRelevantDraft(mergedDraft)) {
      logger.info(
        {
          event: "submission-notification.evaluate.skipped",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          reason: "not_relevant",
          status: mergedDraft.status ?? null,
          isOpen: mergedDraft.isOpen ?? null,
        },
        "Submission notification skipped: draft is not relevant",
      );

      return {
        status: "skipped",
        reason: "not_relevant",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail,
      };
    }

    const approvalReason = resolveApprovalReason(mergedDraft);

    const subject =
      normalizeOptionalString(input.notificationContext?.emailSubject) ||
      (approvalReason === "credit_limit_exceeded"
        ? buildExceededApprovalSubject(mergedDraft)
        : buildStandardApprovalSubject(mergedDraft));

    const text =
      normalizeOptionalString(input.notificationContext?.emailBody) ||
      (approvalReason === "credit_limit_exceeded"
        ? buildExceededApprovalTextBody(mergedDraft)
        : buildStandardApprovalTextBody(mergedDraft));

    const html =
      approvalReason === "credit_limit_exceeded"
        ? buildExceededApprovalHtmlBody(mergedDraft)
        : buildStandardApprovalHtmlBody(mergedDraft);

    const sendResult = await approvalEmailService.send({
      to: approverEmail,
      subject,
      text,
      html,
    });

    if (!sendResult.ok) {
      logger.error(
        {
          event: "submission-notification.email.failed",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          approverEmail,
          approvalReason,
          budgetStatus: mergedDraft.budgetStatus ?? null,
          statusCode: sendResult.statusCode,
          error: sendResult.error,
          hasReviewUrl: Boolean(resolveReviewUrl(mergedDraft)),
        },
        "Submission notification email failed",
      );

      return {
        status: "failed",
        reason: "email_failed",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail,
      };
    }

    const notifiedAt = new Date().toISOString();

    try {
      await this.provider.markSubmissionNotified({
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        notifiedAt,
        approvalState: "notified",
      });
    } catch (error) {
      logger.error(
        {
          event: "submission-notification.mark-notified.failed",
          shop: mergedDraft.shop,
          draftOrderId: mergedDraft.id,
          approverEmail,
          approvalReason,
          budgetStatus: mergedDraft.budgetStatus ?? null,
          notifiedAt,
          error,
        },
        "Submission notification email sent but failed to mark draft as notified",
      );

      return {
        status: "failed",
        reason: "mark_notified_failed",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail,
      };
    }

    logger.info(
      {
        event: "submission-notification.email.sent",
        shop: mergedDraft.shop,
        draftOrderId: mergedDraft.id,
        approverEmail,
        companyLocationId: mergedDraft.companyLocationId,
        approvalReason,
        budgetStatus: mergedDraft.budgetStatus ?? null,
        notifiedAt,
        statusCode: sendResult.statusCode,
        hasReviewUrl: Boolean(resolveReviewUrl(mergedDraft)),
      },
      "Submission notification email sent successfully",
    );

    return {
      status: "sent",
      reason: "sent",
      shop: mergedDraft.shop,
      draftOrderId: mergedDraft.id,
      approverEmail,
    };
  }
}

function mergeDraftWithNotificationContext(
  draft: DraftSubmissionContext,
  context?: SubmissionNotificationContext,
): DraftSubmissionContext {
  const reviewUrl = normalizeOptionalString(context?.reviewUrl);
  const invoiceUrl = normalizeOptionalString(context?.invoiceUrl);
  const approvalLink = reviewUrl || normalizeOptionalString(draft.approvalLink);

  return {
    ...draft,
    name: normalizeOptionalString(context?.draftOrderName) || draft.name,
    poNumber: normalizeOptionalString(context?.purchaseOrderNumber) || draft.poNumber,
    companyName: normalizeOptionalString(context?.companyName) || draft.companyName,
    companyLocationName:
      normalizeOptionalString(context?.companyLocationName) || draft.companyLocationName,
    approverEmail:
      normalizeOptionalString(context?.approverEmail) || draft.approverEmail,
    approvalReason:
      normalizeApprovalReason(context?.approvalReason) || draft.approvalReason,
    reviewUrl,
    invoiceUrl,
    approvalLink,
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

function normalizeOptionalString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function resolveApprovalReason(
  draft: DraftSubmissionContext,
): "standard" | "credit_limit_exceeded" {
  const metafieldReason = normalizeApprovalReason(draft.approvalReason);

  if (metafieldReason) {
    return metafieldReason;
  }

  const normalizedBudgetStatus = normalizeState(draft.budgetStatus);

  if (normalizedBudgetStatus === "exceeded") {
    return "credit_limit_exceeded";
  }

  return "standard";
}

function isRelevantDraft(draft: DraftSubmissionContext): boolean {
  if (draft.isOpen === false) {
    return false;
  }

  const normalizedStatus = (draft.status ?? "").trim().toLowerCase();

  if (
    [
      "closed",
      "completed",
      "complete",
      "converted",
      "cancelled",
      "canceled",
      "archived",
    ].includes(normalizedStatus)
  ) {
    return false;
  }

  return true;
}

function resolveReviewUrl(draft: DraftSubmissionContext): string | null {
  return normalizeOptionalString(draft.reviewUrl) ||
    normalizeOptionalString(draft.approvalLink);
}

function resolveInvoiceUrl(draft: DraftSubmissionContext): string | null {
  return normalizeOptionalString(draft.invoiceUrl);
}

function buildStandardApprovalSubject(draft: DraftSubmissionContext): string {
  const companyName = draft.companyName?.trim() || "Company";
  const draftName = draft.name?.trim() || draft.id;

  return `Approval required: ${companyName} draft ${draftName}`;
}

function buildExceededApprovalSubject(draft: DraftSubmissionContext): string {
  const companyName = draft.companyName?.trim() || "Company";
  const draftName = draft.name?.trim() || draft.id;

  return `Approval required: Credit limit exceeded for ${companyName} draft ${draftName}`;
}

function buildStandardApprovalTextBody(draft: DraftSubmissionContext): string {
  const reviewUrl = resolveReviewUrl(draft);
  const invoiceUrl = resolveInvoiceUrl(draft);

  const lines: string[] = [
    "A draft order has been submitted for approval.",
    "You can review, edit, and approve the order before it is created.",
    "",
    `Company: ${draft.companyName || "N/A"}`,
    `Location: ${draft.companyLocationName || "N/A"}`,
    `Draft order: ${draft.name || draft.id}`,
    `Submitted at: ${formatDateTime(draft.createdAt)}`,
    `Buyer: ${draft.customerName || "N/A"}`,
    `Buyer email: ${draft.customerEmail || "N/A"}`,
    `PO number: ${draft.poNumber || "N/A"}`,
    `Total: ${formatMoney(draft.totalAmount, draft.currencyCode)}`,
  ];

  if (reviewUrl) {
    lines.push("", `Review / edit / approve order: ${reviewUrl}`);
  }

  if (invoiceUrl) {
    lines.push(`Draft invoice: ${invoiceUrl}`);
  }

  return lines.join("\n");
}

function buildExceededApprovalTextBody(draft: DraftSubmissionContext): string {
  const reviewUrl = resolveReviewUrl(draft);
  const invoiceUrl = resolveInvoiceUrl(draft);

  const lines: string[] = [
    "An order has been created on www.centralcleaningsupplies.com.au which has exceeded your assigned credit limit.",
    "You can review, edit, and approve the order before it is created.",
    "",
    `Draft order: ${draft.name || draft.id}`,
    `Company: ${draft.companyName || "N/A"}`,
    `Location: ${draft.companyLocationName || "N/A"}`,
    `Submitted at: ${formatDateTime(draft.createdAt)}`,
    `Buyer: ${draft.customerName || "N/A"}`,
    `Buyer email: ${draft.customerEmail || "N/A"}`,
    `PO number: ${draft.poNumber || "N/A"}`,
    `Order total: ${formatMoney(draft.totalAmount, draft.currencyCode)}`,
    `Triggered by: ${humanizeValue(draft.budgetTriggerScope)}`,
    `Reason: ${humanizeValue(draft.budgetReason)}`,
    `Customer credit limit: ${formatMoney(
      draft.customerCreditLimit,
      draft.currencyCode,
    )}`,
    `Customer remaining credit: ${formatMoney(
      draft.customerRemainingCredit,
      draft.currencyCode,
    )}`,
    `Customer amount exceeded by: ${formatMoney(
      draft.customerAmountExceededBy,
      draft.currencyCode,
    )}`,
    `Company credit limit: ${formatMoney(
      draft.companyCreditLimit,
      draft.currencyCode,
    )}`,
    `Company remaining credit: ${formatMoney(
      draft.companyRemainingCredit,
      draft.currencyCode,
    )}`,
    `Company amount exceeded by: ${formatMoney(
      draft.companyAmountExceededBy,
      draft.currencyCode,
    )}`,
  ];

  if (reviewUrl) {
    lines.push("", `Review / edit / approve order: ${reviewUrl}`);
  }

  if (invoiceUrl) {
    lines.push(`Draft invoice: ${invoiceUrl}`);
  }

  return lines.join("\n");
}

function buildStandardApprovalHtmlBody(draft: DraftSubmissionContext): string {
  const reviewUrl = resolveReviewUrl(draft);
  const invoiceUrl = resolveInvoiceUrl(draft);

  const rows: Array<[string, string]> = [
    ["Company", draft.companyName || "N/A"],
    ["Location", draft.companyLocationName || "N/A"],
    ["Draft order", draft.name || draft.id],
    ["Submitted at", formatDateTime(draft.createdAt)],
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

  const primaryCta = reviewUrl
    ? `
      <p style="margin:24px 0 12px;">
        <a
          href="${escapeHtml(reviewUrl)}"
          style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;"
        >
          Review / edit / approve order
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">
        If the button does not work, copy and paste this URL into your browser:<br />${escapeHtml(reviewUrl)}
      </p>
    `
    : "";

  const secondaryCta = invoiceUrl
    ? `
      <p style="margin:0 0 12px;">
        <a
          href="${escapeHtml(invoiceUrl)}"
          style="color:#111827;text-decoration:underline;font-weight:600;"
        >
          Open draft invoice
        </a>
      </p>
    `
    : "";

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p>A draft order has been submitted for approval.</p>
      <p>You can review, edit, and approve the order before it is created.</p>

      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        ${tableRows}
      </table>

      ${primaryCta}
      ${secondaryCta}
    </div>
  `.trim();
}

function buildExceededApprovalHtmlBody(draft: DraftSubmissionContext): string {
  const reviewUrl = resolveReviewUrl(draft);
  const invoiceUrl = resolveInvoiceUrl(draft);

  const rows: Array<[string, string]> = [
    ["Draft order", draft.name || draft.id],
    ["Company", draft.companyName || "N/A"],
    ["Location", draft.companyLocationName || "N/A"],
    ["Submitted at", formatDateTime(draft.createdAt)],
    ["Buyer", draft.customerName || "N/A"],
    ["Buyer email", draft.customerEmail || "N/A"],
    ["PO number", draft.poNumber || "N/A"],
    ["Order total", formatMoney(draft.totalAmount, draft.currencyCode)],
    ["Triggered by", humanizeValue(draft.budgetTriggerScope)],
    ["Reason", humanizeValue(draft.budgetReason)],
    [
      "Customer credit limit",
      formatMoney(draft.customerCreditLimit, draft.currencyCode),
    ],
    [
      "Customer remaining credit",
      formatMoney(draft.customerRemainingCredit, draft.currencyCode),
    ],
    [
      "Customer amount exceeded by",
      formatMoney(draft.customerAmountExceededBy, draft.currencyCode),
    ],
    [
      "Company credit limit",
      formatMoney(draft.companyCreditLimit, draft.currencyCode),
    ],
    [
      "Company remaining credit",
      formatMoney(draft.companyRemainingCredit, draft.currencyCode),
    ],
    [
      "Company amount exceeded by",
      formatMoney(draft.companyAmountExceededBy, draft.currencyCode),
    ],
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

  const primaryCta = reviewUrl
    ? `
      <p style="margin:24px 0 12px;">
        <a
          href="${escapeHtml(reviewUrl)}"
          style="display:inline-block;padding:12px 18px;background:#b91c1c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;"
        >
          Review / edit / approve order
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">
        If the button does not work, copy and paste this URL into your browser:<br />${escapeHtml(reviewUrl)}
      </p>
    `
    : "";

  const secondaryCta = invoiceUrl
    ? `
      <p style="margin:0 0 12px;">
        <a
          href="${escapeHtml(invoiceUrl)}"
          style="color:#111827;text-decoration:underline;font-weight:600;"
        >
          Open draft invoice
        </a>
      </p>
    `
    : "";

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
      <p style="font-weight:700;color:#b91c1c;">
        An order has been created on www.centralcleaningsupplies.com.au which has exceeded your assigned credit limit.
      </p>
      <p>You can review, edit, and approve the order before it is created.</p>

      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        ${tableRows}
      </table>

      ${primaryCta}
      ${secondaryCta}
    </div>
  `.trim();
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

function humanizeValue(value?: string | null): string {
  if (!value) {
    return "N/A";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
