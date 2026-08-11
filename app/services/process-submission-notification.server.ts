import { logger } from "../lib/logger.server";
import {
  SubmissionNotificationEvaluatorService,
  type SubmissionNotificationResult,
} from "./submission-notification-evaluator.server";
import {
  ShopifySubmissionNotificationDataProvider,
  type AdminGraphqlExecutor,
} from "./submission-notification-provider.server";

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

export interface ProcessSubmissionNotificationInput {
  shop: string;
  draftOrderId: string;
  graphql: AdminGraphqlExecutor;
  notificationContext?: SubmissionNotificationContext;
}

type SubmissionNotificationEvaluatorLike = {
  evaluate: (input: {
    shop: string;
    draftOrderId: string;
    notificationContext?: SubmissionNotificationContext;
  }) => Promise<SubmissionNotificationResult>;
};

export async function processSubmissionNotification({
  shop,
  draftOrderId,
  graphql,
  notificationContext,
}: ProcessSubmissionNotificationInput): Promise<SubmissionNotificationResult> {
  const normalizedContext = normalizeNotificationContext(notificationContext);

  logger.info(
    {
      event: "submission-notification.process.start",
      shop,
      draftOrderId,
      hasNotificationContext: Boolean(normalizedContext),
      hasApprovalReason: Boolean(normalizedContext?.approvalReason),
      hasApproverEmail: Boolean(normalizedContext?.approverEmail),
      hasReviewUrl: Boolean(normalizedContext?.reviewUrl),
      hasInvoiceUrl: Boolean(normalizedContext?.invoiceUrl),
      hasEmailSubject: Boolean(normalizedContext?.emailSubject),
      hasEmailBody: Boolean(normalizedContext?.emailBody),
      hasPurchaseOrderNumber: Boolean(normalizedContext?.purchaseOrderNumber),
      hasDraftOrderName: Boolean(normalizedContext?.draftOrderName),
      hasCompanyName: Boolean(normalizedContext?.companyName),
      hasCompanyLocationName: Boolean(normalizedContext?.companyLocationName),
    },
    "Processing submission notification",
  );

  const provider = new ShopifySubmissionNotificationDataProvider(graphql);
  const evaluator = new SubmissionNotificationEvaluatorService(provider);

  try {
    const result = await (evaluator as SubmissionNotificationEvaluatorLike).evaluate({
      shop,
      draftOrderId,
      notificationContext: normalizedContext,
    });

    logger.info(
      {
        event: "submission-notification.process.complete",
        shop,
        draftOrderId,
        status: result.status,
        reason: result.reason,
        approverEmail: result.approverEmail,
        hasNotificationContext: Boolean(normalizedContext),
        usedReviewUrl: Boolean(normalizedContext?.reviewUrl),
      },
      "Completed submission notification processing",
    );

    return result;
  } catch (error) {
    logger.error(
      {
        event: "submission-notification.process.failed",
        shop,
        draftOrderId,
        hasNotificationContext: Boolean(normalizedContext),
        error,
      },
      "Submission notification processing threw an unhandled error",
    );

    throw error;
  }
}

function normalizeNotificationContext(
  value: SubmissionNotificationContext | null | undefined,
): SubmissionNotificationContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const normalized: SubmissionNotificationContext = {
    approvalReason: normalizeOptionalString(value.approvalReason),
    approverEmail: normalizeOptionalString(value.approverEmail),
    reviewUrl: normalizeOptionalString(value.reviewUrl),
    invoiceUrl: normalizeOptionalString(value.invoiceUrl),
    emailSubject: normalizeOptionalString(value.emailSubject),
    emailBody: normalizeOptionalString(value.emailBody),
    purchaseOrderNumber: normalizeOptionalString(value.purchaseOrderNumber),
    draftOrderName: normalizeOptionalString(value.draftOrderName),
    companyName: normalizeOptionalString(value.companyName),
    companyLocationName: normalizeOptionalString(value.companyLocationName),
  };

  if (
    !normalized.approvalReason &&
    !normalized.approverEmail &&
    !normalized.reviewUrl &&
    !normalized.invoiceUrl &&
    !normalized.emailSubject &&
    !normalized.emailBody &&
    !normalized.purchaseOrderNumber &&
    !normalized.draftOrderName &&
    !normalized.companyName &&
    !normalized.companyLocationName
  ) {
    return undefined;
  }

  return normalized;
}

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
