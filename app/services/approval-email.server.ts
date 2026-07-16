import { config } from "../lib/config.server";

const SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

export type ApprovalEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type ApprovalEmailResult = {
  ok: boolean;
  provider: "sendgrid";
  statusCode: number;
  messageId: string | null;
  error: string | null;
};

function normalizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => escapeHtml(line))
    .join("<br />");
}

function extractSendGridError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const maybeErrors = (payload as { errors?: Array<{ message?: string }> }).errors;
  if (Array.isArray(maybeErrors) && maybeErrors.length > 0) {
    return maybeErrors
      .map((item) => item?.message)
      .filter(Boolean)
      .join("; ");
  }

  return null;
}

export async function sendApprovalEmail(
  input: ApprovalEmailInput,
): Promise<ApprovalEmailResult> {
  const to = normalizeSingleLine(input.to);
  const subject = normalizeSingleLine(input.subject);
  const text = input.text.trim();
  const html = input.html?.trim() || textToHtml(text);
  const replyTo = normalizeSingleLine(
    input.replyTo || config.SENDGRID_REPLY_TO_EMAIL,
  );

  if (!to) {
    return {
      ok: false,
      provider: "sendgrid",
      statusCode: 0,
      messageId: null,
      error: "Recipient email is required",
    };
  }

  if (!subject) {
    return {
      ok: false,
      provider: "sendgrid",
      statusCode: 0,
      messageId: null,
      error: "Email subject is required",
    };
  }

  if (!text) {
    return {
      ok: false,
      provider: "sendgrid",
      statusCode: 0,
      messageId: null,
      error: "Email body text is required",
    };
  }

  try {
    const response = await fetch(SENDGRID_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: to }],
            subject,
          },
        ],
        from: {
          email: config.SENDGRID_FROM_EMAIL,
          name: config.SENDGRID_FROM_NAME,
        },
        reply_to: {
          email: replyTo,
        },
        content: [
          {
            type: "text/plain",
            value: text,
          },
          {
            type: "text/html",
            value: html,
          },
        ],
      }),
    });

    const messageId = response.headers.get("x-message-id");

    if (response.ok) {
      return {
        ok: true,
        provider: "sendgrid",
        statusCode: response.status,
        messageId,
        error: null,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let error = `SendGrid request failed with status ${response.status}`;

    if (contentType.includes("application/json")) {
      const json = await response.json().catch(() => null);
      error = extractSendGridError(json) || error;
    } else {
      const textBody = await response.text().catch(() => "");
      if (textBody) error = textBody;
    }

    return {
      ok: false,
      provider: "sendgrid",
      statusCode: response.status,
      messageId,
      error,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "sendgrid",
      statusCode: 0,
      messageId: null,
      error:
        error instanceof Error ? error.message : "Unknown SendGrid error",
    };
  }
}

export class ApprovalEmailService {
  send(input: ApprovalEmailInput) {
    return sendApprovalEmail(input);
  }
}

export const approvalEmailService = new ApprovalEmailService();
