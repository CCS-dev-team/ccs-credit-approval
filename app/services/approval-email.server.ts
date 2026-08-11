import { config } from "../lib/config.server";
import { logger } from "../lib/logger.server";

export type SendApprovalEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendApprovalEmailResult = {
  ok: boolean;
  statusCode?: number;
  error?: string;
};

type SendGridContentItem = {
  type: "text/plain" | "text/html";
  value: string;
};

class ApprovalEmailService {
  async send({
    to,
    subject,
    text,
    html,
  }: SendApprovalEmailInput): Promise<SendApprovalEmailResult> {
    if (!config.SENDGRID_API_KEY) {
      return {
        ok: false,
        error: "SENDGRID_API_KEY is not configured",
      };
    }

    if (!config.SENDGRID_FROM_EMAIL) {
      return {
        ok: false,
        error: "SENDGRID_FROM_EMAIL is not configured",
      };
    }

    const normalizedTo = normalizeEmail(to);
    const normalizedSubject = normalizeText(subject);
    const normalizedText = normalizeText(text);
    const normalizedHtml = normalizeOptionalText(html);

    if (!normalizedTo) {
      return {
        ok: false,
        error: "Recipient email is required",
      };
    }

    if (!isValidEmail(normalizedTo)) {
      return {
        ok: false,
        error: "Recipient email is invalid",
      };
    }

    if (!normalizedSubject) {
      return {
        ok: false,
        error: "Email subject is required",
      };
    }

    if (!normalizedText && !normalizedHtml) {
      return {
        ok: false,
        error: "Email body is required",
      };
    }

    const content: SendGridContentItem[] = [];

    if (normalizedText) {
      content.push({
        type: "text/plain",
        value: normalizedText,
      });
    }

    if (normalizedHtml) {
      content.push({
        type: "text/html",
        value: normalizedHtml,
      });
    }

    const payload: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: normalizedTo }],
          subject: normalizedSubject,
        },
      ],
      from: {
        email: config.SENDGRID_FROM_EMAIL,
        name: config.SENDGRID_FROM_NAME || undefined,
      },
      content,
      tracking_settings: {
        click_tracking: {
          enable: false,
          enable_text: false,
        },
      },
    };

    if (config.SENDGRID_REPLY_TO_EMAIL) {
      payload.reply_to = {
        email: config.SENDGRID_REPLY_TO_EMAIL,
      };
    }

    let response: Response;

    try {
      response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SendGrid request error";

      logger.error(
        {
          event: "approval-email.send.request-failed",
          to: normalizedTo,
          subject: normalizedSubject,
          message,
          error,
          clickTrackingDisabled: true,
        },
        "Approval email request to SendGrid failed",
      );

      return {
        ok: false,
        error: message,
      };
    }

    if (response.ok) {
      logger.info(
        {
          event: "approval-email.send.success",
          to: normalizedTo,
          subject: normalizedSubject,
          statusCode: response.status,
          clickTrackingDisabled: true,
        },
        "Approval email sent successfully",
      );

      return {
        ok: true,
        statusCode: response.status,
      };
    }

    let responseText = "";

    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }

    logger.error(
      {
        event: "approval-email.send.failed",
        to: normalizedTo,
        subject: normalizedSubject,
        statusCode: response.status,
        responseText,
        clickTrackingDisabled: true,
      },
      "Approval email failed",
    );

    return {
      ok: false,
      statusCode: response.status,
      error: responseText || `SendGrid returned HTTP ${response.status}`,
    };
  }
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const approvalEmailService = new ApprovalEmailService();
