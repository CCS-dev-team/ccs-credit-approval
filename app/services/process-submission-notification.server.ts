import { logger } from "../lib/logger.server";
import {
  SubmissionNotificationEvaluatorService,
  type SubmissionNotificationResult,
} from "./submission-notification-evaluator.server";
import {
  ShopifySubmissionNotificationDataProvider,
  type AdminGraphqlExecutor,
} from "./submission-notification-provider.server";

export interface ProcessSubmissionNotificationInput {
  shop: string;
  draftOrderId: string;
  graphql: AdminGraphqlExecutor;
}

export async function processSubmissionNotification({
  shop,
  draftOrderId,
  graphql,
}: ProcessSubmissionNotificationInput): Promise<SubmissionNotificationResult> {
  logger.info(
    {
      event: "submission-notification.process.start",
      shop,
      draftOrderId,
    },
    "Processing submission notification",
  );

  const provider = new ShopifySubmissionNotificationDataProvider(graphql);
  const evaluator = new SubmissionNotificationEvaluatorService(provider);

  const result = await evaluator.evaluate({
    shop,
    draftOrderId,
  });

  logger.info(
    {
      event: "submission-notification.process.complete",
      shop,
      draftOrderId,
      status: result.status,
      reason: result.reason,
      approverEmail: result.approverEmail,
    },
    "Completed submission notification processing",
  );

  return result;
}
