import type {
  BudgetDataProvider,
  CreditSnapshot,
} from "./budget-decision.server";

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export class ShopifyBudgetProvider implements BudgetDataProvider {
  constructor(private admin: AdminGraphqlClient) {}

  async getCustomerCredit(customerId: string): Promise<CreditSnapshot | null> {
    // Customer object access is still blocked in the current dev-store flow.
    return null;
  }

  async getCompanyCredit(companyId: string): Promise<CreditSnapshot | null> {
    const query = `#graphql
      query GetCompanyCredit($id: ID!) {
        company(id: $id) {
          id
          creditLimit: metafield(namespace: "custom", key: "credit_limit") {
            value
            type
          }
          remainingCredit: metafield(namespace: "custom", key: "remaining_credit") {
            value
            type
          }
        }
      }
    `;

    const response = await this.admin.graphql(query, {
      variables: { id: companyId },
    });

    const json = await response.json();
    const company = json?.data?.company;

    if (!company) {
      return null;
    }

    return {
      creditLimit:
        company.creditLimit?.value != null
          ? Number(company.creditLimit.value)
          : null,
      remainingCredit:
        company.remainingCredit?.value != null
          ? Number(company.remainingCredit.value)
          : null,
    };
  }

  async getCompanyLocationApprover(
    companyLocationId: string,
    companyId?: string | null,
  ): Promise<string | null> {
    if (!companyId) {
      return null;
    }

    const query = `#graphql
      query GetCompanyLocationApproverFromCompany($companyId: ID!) {
        company(id: $companyId) {
          id
          locations(first: 50) {
            nodes {
              id
              name
              approverEmail: metafield(namespace: "custom", key: "workflow_approver_email") {
                value
                type
              }
            }
          }
        }
      }
    `;

    const response = await this.admin.graphql(query, {
      variables: { companyId },
    });

    const json = await response.json();
    const locations = json?.data?.company?.locations?.nodes ?? [];

    const matchingLocation = locations.find(
      (location: { id: string; approverEmail?: { value?: string } | null }) =>
        location.id === companyLocationId,
    );

    return matchingLocation?.approverEmail?.value ?? null;
  }
}
