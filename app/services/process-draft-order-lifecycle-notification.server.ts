import { logger } from "../lib/logger.server";
import {
  DraftOrderLifecycleNotificationEvaluatorService,
  type DraftOrderLifecycleNotificationResult,
} from "./draft-order-lifecycle-notification-evaluator.server";
import {
  ShopifySubmissionNotificationDataProvider,
  type AdminGraphqlExecutor,
} from "./submission-notification-provider.server";

export interface DraftOrderLifecycleNotificationContext {
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

export interface ProcessDraftOrderLifecycleNotificationInput {
  shop: string;
  draftOrderId: string;
  graphql: AdminGraphqlExecutor;
  notificationContext?: DraftOrderLifecycleNotificationContext;
}

export async function processDraftOrderLifecycleNotification({
  shop,
  draftOrderId,
  graphql,
  notificationContext,
}: ProcessDraftOrderLifecycleNotificationInput): Promise<DraftOrderLifecycleNotificationResult> {
  const normalizedContext = normalizeNotificationContext(notificationContext);

  logger.info(
    {
      event: "draft-order-lifecycle.process.start",
      shop,
      draftOrderId,
      hasNotificationContext: Boolean(normalizedContext),
      hasApprovalReason: Boolean(normalizedContext?.approvalReason),
      hasWorkflowApprovalState: Boolean(normalizedContext?.workflowApprovalState),
      hasCreatorEmail: Boolean(normalizedContext?.creatorEmail),
      hasApproverEmail: Boolean(normalizedContext?.approverEmail),
      hasReviewUrl: Boolean(normalizedContext?.reviewUrl),
      hasInvoiceUrl: Boolean(normalizedContext?.invoiceUrl),
      hasPurchaseOrderNumber: Boolean(normalizedContext?.purchaseOrderNumber),
      hasDraftOrderName: Boolean(normalizedContext?.draftOrderName),
      hasCompanyName: Boolean(normalizedContext?.companyName),
      hasCompanyLocationName: Boolean(normalizedContext?.companyLocationName),
      hasRejectionReason: Boolean(normalizedContext?.rejectionReason),
      inferredRejectedFromReason: Boolean(
        normalizedContext?.rejectionReason &&
          normalizedContext?.workflowApprovalState === "rejected",
      ),
    },
    "Processing draft order lifecycle notification",
  );

  const provider = new ShopifySubmissionNotificationDataProvider(graphql);
  const evaluator = new DraftOrderLifecycleNotificationEvaluatorService(provider);

  try {
    const result = await evaluator.evaluate({
      shop,
      draftOrderId,
      notificationContext: normalizedContext,
    });

    logger.info(
      {
        event: "draft-order-lifecycle.process.complete",
        shop,
        draftOrderId,
        status: result.status,
        reason: result.reason,
        lifecycleState: result.lifecycleState,
        creatorEmail: result.creatorEmail,
        hasNotificationContext: Boolean(normalizedContext),
        usedWorkflowApprovalState:
          normalizedContext?.workflowApprovalState ?? null,
        usedReviewUrl: Boolean(normalizedContext?.reviewUrl),
        usedInvoiceUrl: Boolean(normalizedContext?.invoiceUrl),
        usedRejectionReason: Boolean(normalizedContext?.rejectionReason),
      },
      "Completed draft order lifecycle notification processing",
    );

    return result;
  } catch (error) {
    logger.error(
      {
        event: "draft-order-lifecycle.process.failed",
        shop,
        draftOrderId,
        hasNotificationContext: Boolean(normalizedContext),
        hasWorkflowApprovalState: Boolean(
          normalizedContext?.workflowApprovalState,
        ),
        hasCreatorEmail: Boolean(normalizedContext?.creatorEmail),
        hasRejectionReason: Boolean(normalizedContext?.rejectionReason),
        error,
      },
      "Draft order lifecycle notification processing threw an unhandled error",
    );

    throw error;
  }
}

function normalizeNotificationContext(
  value: DraftOrderLifecycleNotificationContext | null | undefined,
): DraftOrderLifecycleNotificationContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const rejectionReason = normalizeOptionalString(value.rejectionReason);
  const workflowApprovalState = normalizeWorkflowApprovalState(
    value.workflowApprovalState,
    rejectionReason,
  );

  const normalized: DraftOrderLifecycleNotificationContext = {
    approvalReason: normalizeOptionalString(value.approvalReason),
    workflowApprovalState,
    creatorEmail: normalizeEmail(value.creatorEmail),
    approverEmail: normalizeEmail(value.approverEmail),
    reviewUrl: normalizeOptionalString(value.reviewUrl),
    invoiceUrl: normalizeOptionalString(value.invoiceUrl),
    purchaseOrderNumber: normalizeOptionalString(value.purchaseOrderNumber),
    draftOrderName: normalizeOptionalString(value.draftOrderName),
    companyName: normalizeOptionalString(value.companyName),
    companyLocationName: normalizeOptionalString(value.companyLocationName),
    rejectionReason,
  };

  if (
    !normalized.approvalReason &&
    !normalized.workflowApprovalState &&
    !normalized.creatorEmail &&
    !normalized.approverEmail &&
    !normalized.reviewUrl &&
    !normalized.invoiceUrl &&
    !normalized.purchaseOrderNumber &&
    !normalized.draftOrderName &&
    !normalized.companyName &&
    !normalized.companyLocationName &&
    !normalized.rejectionReason
  ) {
    return undefined;
  }

  return normalized;
}

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeEmail(
  value: string | null | undefined,
): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function normalizeWorkflowApprovalState(
  value: string | null | undefined,
  rejectionReason?: string,
): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();

  if (normalized) {
    return normalized;
  }

  if (rejectionReason) {
    return "rejected";
  }

  return undefined;
}
