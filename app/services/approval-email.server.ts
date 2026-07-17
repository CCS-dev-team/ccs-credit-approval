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

    if (!to) {
      return {
        ok: false,
        error: "Recipient email is required",
      };
    }

    const content = [
      {
        type: "text/plain",
        value: text,
      },
    ];

    if (html) {
      content.push({
        type: "text/html",
        value: html,
      });
    }

    const payload: Record<string, unknown> = {
      personalizations: [
        {
          to: [{ email: to }],
          subject,
        },
      ],
      from: {
        email: config.SENDGRID_FROM_EMAIL,
        name: config.SENDGRID_FROM_NAME || undefined,
      },
      content,
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
          to,
          subject,
          message,
          error,
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
          to,
          subject,
          statusCode: response.status,
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
        to,
        subject,
        statusCode: response.status,
        responseText,
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

export const approvalEmailService = new ApprovalEmailService();
