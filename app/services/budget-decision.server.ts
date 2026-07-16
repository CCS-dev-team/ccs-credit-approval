import { logger } from "../lib/logger.server";
import { config } from "../lib/config.server";

export type BudgetSource = "user" | "company" | "none";
export type BudgetDecisionStatus =
  | "within_limit"
  | "exceeded"
  | "config_rejected"
  | "invalid_config";

export type BudgetReason =
  | "user_limit"
  | "company_limit"
  | "missing_approver"
  | "config_rejected"
  | "within_limit"
  | "invalid_config";

export interface BudgetDecisionInput {
  customerId: string;
  companyId?: string | null;
  companyLocationId?: string | null;
  orderTotal: number;
}

export interface CreditSnapshot {
  creditLimit: number | null;
  remainingCredit: number | null;
}

export interface BudgetDecisionResult {
  status: BudgetDecisionStatus;
  source: BudgetSource;
  reason: BudgetReason;
  approverEmail: string | null;
  fallbackUsed: boolean;
  limitApplied: number | null;
  remainingSnapshot: number | null;
  amountExceededBy: number;
  configResolution: "user_precedence" | "company_precedence" | "config_rejected" | "not_applicable";
}

export interface BudgetDataProvider {
  getCustomerCredit(customerId: string): Promise<CreditSnapshot | null>;
  getCompanyCredit(companyId: string): Promise<CreditSnapshot | null>;
  getCompanyLocationApprover(
  companyLocationId: string,
  companyId?: string | null,
): Promise<string | null>;

}

export class BudgetDecisionService {
  constructor(private provider: BudgetDataProvider) {}

  async resolve(input: BudgetDecisionInput): Promise<BudgetDecisionResult> {
    logger.info(
      {
        event: "budget.resolve.start",
        customerId: input.customerId,
        companyId: input.companyId,
        companyLocationId: input.companyLocationId,
        orderTotal: input.orderTotal,
      },
      "Starting budget resolution",
    );

    const customerCredit = await this.provider.getCustomerCredit(input.customerId);
    const companyCredit = input.companyId
      ? await this.provider.getCompanyCredit(input.companyId)
      : null;

    const approverEmail = input.companyLocationId
  ? await this.provider.getCompanyLocationApprover(
      input.companyLocationId,
      input.companyId ?? null,
    )
  : null;


    const hasUserBudget =
      !!customerCredit &&
      customerCredit.creditLimit !== null &&
      customerCredit.remainingCredit !== null;

    const hasCompanyBudget =
      !!companyCredit &&
      companyCredit.creditLimit !== null &&
      companyCredit.remainingCredit !== null;

    if (hasUserBudget && hasCompanyBudget && config.ALLOW_CONFIG_REJECT) {
      return {
        status: "config_rejected",
        source: "none",
        reason: "config_rejected",
        approverEmail: null,
        fallbackUsed: false,
        limitApplied: null,
        remainingSnapshot: null,
        amountExceededBy: 0,
        configResolution: "config_rejected",
      };
    }

    let source: BudgetSource = "none";
    let snapshot: CreditSnapshot | null = null;
    let configResolution: BudgetDecisionResult["configResolution"] = "not_applicable";

    if (hasUserBudget) {
      source = "user";
      snapshot = customerCredit;
      configResolution = "user_precedence";
    } else if (hasCompanyBudget) {
      source = "company";
      snapshot = companyCredit;
      configResolution = "company_precedence";
    }

    if (!snapshot) {
      return {
        status: "invalid_config",
        source: "none",
        reason: "invalid_config",
        approverEmail: null,
        fallbackUsed: false,
        limitApplied: null,
        remainingSnapshot: null,
        amountExceededBy: 0,
        configResolution,
      };
    }

    const amountExceededBy = Math.max(0, input.orderTotal - (snapshot.remainingCredit ?? 0));
    const exceeded = amountExceededBy > 0;

    const resolvedApprover = approverEmail || config.FALLBACK_APPROVER_EMAIL;
    const fallbackUsed = !approverEmail;

    const result: BudgetDecisionResult = {
      status: exceeded ? "exceeded" : "within_limit",
      source,
      reason: exceeded
        ? source === "user"
          ? fallbackUsed
            ? "missing_approver"
            : "user_limit"
          : fallbackUsed
            ? "missing_approver"
            : "company_limit"
        : "within_limit",
      approverEmail: resolvedApprover,
      fallbackUsed,
      limitApplied: snapshot.creditLimit,
      remainingSnapshot: snapshot.remainingCredit,
      amountExceededBy,
      configResolution,
    };

    logger.info(
      {
        event: "budget.resolve.complete",
        customerId: input.customerId,
        companyId: input.companyId,
        companyLocationId: input.companyLocationId,
        decision: result.status,
        source: result.source,
        amountExceededBy: result.amountExceededBy,
        fallbackUsed: result.fallbackUsed,
      },
      "Budget resolution complete",
    );

    return result;
  }
}