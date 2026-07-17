import { logger } from "../lib/logger.server";
import { config } from "../lib/config.server";

export type BudgetSource = "user" | "company" | "both" | "none";
export type BudgetDecisionStatus =
  | "within_limit"
  | "exceeded"
  | "config_rejected"
  | "invalid_config";

export type BudgetReason =
  | "user_limit"
  | "customer_limit"
  | "company_limit"
  | "both_limits"
  | "missing_approver"
  | "config_rejected"
  | "within_limit"
  | "invalid_config";

export type BudgetTriggerScope = "customer" | "company" | "both" | "none";

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
  triggerScope: BudgetTriggerScope;
  approverEmail: string | null;
  fallbackUsed: boolean;
  limitApplied: number | null;
  remainingSnapshot: number | null;
  amountExceededBy: number;
  customerLimitApplied: number | null;
  customerRemainingSnapshot: number | null;
  customerAmountExceededBy: number;
  companyLimitApplied: number | null;
  companyRemainingSnapshot: number | null;
  companyAmountExceededBy: number;
  configResolution:
    | "user_precedence"
    | "company_precedence"
    | "dual_monitor"
    | "config_rejected"
    | "not_applicable";
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

    if (!hasUserBudget && !hasCompanyBudget) {
      return {
        status: "invalid_config",
        source: "none",
        reason: "invalid_config",
        triggerScope: "none",
        approverEmail: null,
        fallbackUsed: false,
        limitApplied: null,
        remainingSnapshot: null,
        amountExceededBy: 0,
        customerLimitApplied: null,
        customerRemainingSnapshot: null,
        customerAmountExceededBy: 0,
        companyLimitApplied: null,
        companyRemainingSnapshot: null,
        companyAmountExceededBy: 0,
        configResolution: "not_applicable",
      };
    }

    const customerAmountExceededBy = hasUserBudget
      ? Math.max(0, input.orderTotal - (customerCredit?.remainingCredit ?? 0))
      : 0;

    const companyAmountExceededBy = hasCompanyBudget
      ? Math.max(0, input.orderTotal - (companyCredit?.remainingCredit ?? 0))
      : 0;

    const customerExceeded = hasUserBudget && customerAmountExceededBy > 0;
    const companyExceeded = hasCompanyBudget && companyAmountExceededBy > 0;
    const exceeded = customerExceeded || companyExceeded;

    const resolvedApprover = approverEmail || config.FALLBACK_APPROVER_EMAIL;
    const fallbackUsed = exceeded && !approverEmail;

    let source: BudgetSource = "none";
    let reason: BudgetReason = "within_limit";
    let triggerScope: BudgetTriggerScope = "none";
    let limitApplied: number | null = null;
    let remainingSnapshot: number | null = null;
    let amountExceededBy = 0;

    if (customerExceeded && companyExceeded) {
      source = "both";
      reason = "both_limits";
      triggerScope = "both";
      limitApplied = null;
      remainingSnapshot = null;
      amountExceededBy = Math.max(
        customerAmountExceededBy,
        companyAmountExceededBy,
      );
    } else if (customerExceeded) {
      source = "user";
      reason = "customer_limit";
      triggerScope = "customer";
      limitApplied = customerCredit?.creditLimit ?? null;
      remainingSnapshot = customerCredit?.remainingCredit ?? null;
      amountExceededBy = customerAmountExceededBy;
    } else if (companyExceeded) {
      source = "company";
      reason = "company_limit";
      triggerScope = "company";
      limitApplied = companyCredit?.creditLimit ?? null;
      remainingSnapshot = companyCredit?.remainingCredit ?? null;
      amountExceededBy = companyAmountExceededBy;
    } else {
      source =
        hasUserBudget && hasCompanyBudget
          ? "both"
          : hasUserBudget
            ? "user"
            : "company";
      reason = "within_limit";
      triggerScope = "none";

      if (hasUserBudget && !hasCompanyBudget) {
        limitApplied = customerCredit?.creditLimit ?? null;
        remainingSnapshot = customerCredit?.remainingCredit ?? null;
      } else if (!hasUserBudget && hasCompanyBudget) {
        limitApplied = companyCredit?.creditLimit ?? null;
        remainingSnapshot = companyCredit?.remainingCredit ?? null;
      }

      amountExceededBy = 0;
    }

    const configResolution: BudgetDecisionResult["configResolution"] =
      hasUserBudget && hasCompanyBudget
        ? "dual_monitor"
        : hasUserBudget
          ? "user_precedence"
          : hasCompanyBudget
            ? "company_precedence"
            : "not_applicable";

    const result: BudgetDecisionResult = {
      status: exceeded ? "exceeded" : "within_limit",
      source,
      reason,
      triggerScope,
      approverEmail: resolvedApprover,
      fallbackUsed,
      limitApplied,
      remainingSnapshot,
      amountExceededBy,
      customerLimitApplied: customerCredit?.creditLimit ?? null,
      customerRemainingSnapshot: customerCredit?.remainingCredit ?? null,
      customerAmountExceededBy,
      companyLimitApplied: companyCredit?.creditLimit ?? null,
      companyRemainingSnapshot: companyCredit?.remainingCredit ?? null,
      companyAmountExceededBy,
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
        triggerScope: result.triggerScope,
        customerExceeded: customerExceeded,
        companyExceeded: companyExceeded,
        customerAmountExceededBy: result.customerAmountExceededBy,
        companyAmountExceededBy: result.companyAmountExceededBy,
        fallbackUsed: result.fallbackUsed,
      },
      "Budget resolution complete",
    );

    return result;
  }
}
