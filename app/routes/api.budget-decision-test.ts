import type { LoaderFunctionArgs } from "react-router";
import { BudgetDecisionService } from "../services/budget-decision.server";
import { MockBudgetProvider } from "../services/mock-budget-provider.server";
import { createRequestLogger } from "../lib/request-logger.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const log = createRequestLogger(request);

  const service = new BudgetDecisionService(new MockBudgetProvider());

  const result = await service.resolve({
    customerId: "gid://shopify/Customer/1",
    companyId: "gid://shopify/Company/1",
    companyLocationId: "gid://shopify/CompanyLocation/1",
    orderTotal: 1500,
  });

  log.info(
    {
      event: "budget.test.result",
      decision: result.status,
      source: result.source,
    },
    "Budget decision test completed",
  );

  return Response.json(result);
}