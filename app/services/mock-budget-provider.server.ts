import type { BudgetDataProvider, CreditSnapshot } from "./budget-decision.server";

export class MockBudgetProvider implements BudgetDataProvider {
  async getCustomerCredit(customerId: string): Promise<CreditSnapshot | null> {
    return {
      creditLimit: 5000,
      remainingCredit: 1200,
    };
  }

  async getCompanyCredit(companyId: string): Promise<CreditSnapshot | null> {
    return null;
  }

  async getCompanyLocationApprover(companyLocationId: string): Promise<string | null> {
    return "approvals@example.com";
  }
}