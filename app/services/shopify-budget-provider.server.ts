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
    const query = `#graphql
      query GetCustomerCredit($id: ID!) {
        customer(id: $id) {
          id
          creditLimit: metafield(namespace: "custom", key: "credit_limit") {
            value
            type
          }
          remainingCredit: metafield(namespace: "custom", key: "remaining_credit") {
            value
            type
          }
          creditLog: metafield(namespace: "custom", key: "credit_log") {
            value
            type
          }
        }
      }
    `;

    const response = await this.admin.graphql(query, {
      variables: { id: customerId },
    });

    const json = await response.json();
    const customer = json?.data?.customer;

    if (!customer) {
      return null;
    }

    return {
      creditLimit:
        customer.creditLimit?.value != null
          ? Number(customer.creditLimit.value)
          : null,
      remainingCredit:
        customer.remainingCredit?.value != null
          ? Number(customer.remainingCredit.value)
          : null,
    };
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
  void companyId;

  const query = `#graphql
    query GetCompanyLocationApprover($id: ID!) {
      companyLocation(id: $id) {
        id
        name
        approverEmailWorkflow: metafield(namespace: "workflow", key: "approver_email") {
          value
          type
        }
        approverEmailCustom: metafield(namespace: "custom", key: "workflow_approver_email") {
          value
          type
        }
      }
    }
  `;

  const response = await this.admin.graphql(query, {
    variables: { id: companyLocationId },
  });

  const json = await response.json();
  const location = json?.data?.companyLocation;

  if (!location) {
    return null;
  }

  const workflowEmail =
    typeof location.approverEmailWorkflow?.value === "string"
      ? location.approverEmailWorkflow.value.trim()
      : "";

  const customEmail =
    typeof location.approverEmailCustom?.value === "string"
      ? location.approverEmailCustom.value.trim()
      : "";

  return workflowEmail || customEmail || null;
}
}