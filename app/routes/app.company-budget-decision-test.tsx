import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ShopifyBudgetProvider } from "../services/shopify-budget-provider.server";
import { BudgetDecisionService } from "../services/budget-decision.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const orderTotalParam = url.searchParams.get("orderTotal");
  const parsedOrderTotal = orderTotalParam ? Number(orderTotalParam) : 5000;
  const orderTotal = Number.isFinite(parsedOrderTotal) ? parsedOrderTotal : 5000;

  const companyId = "gid://shopify/Company/168036368695";
  const companyLocationId = "gid://shopify/CompanyLocation/172949635383";

  const provider = new ShopifyBudgetProvider(admin);
  const decisionService = new BudgetDecisionService(provider);

  const companyCredit = await provider.getCompanyCredit(companyId);
  const approverEmail = await provider.getCompanyLocationApprover(
    companyLocationId,
    companyId,
  );

  const decision = await decisionService.resolve({
    customerId: "gid://shopify/Customer/DEV-PLACEHOLDER",
    companyId,
    companyLocationId,
    orderTotal,
  });

  return Response.json({
    ok: true,
    companyId,
    companyLocationId,
    orderTotal,
    companyCredit,
    approverEmail,
    decision,
  });
}

export default function CompanyBudgetDecisionTestPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "24px" }}>
      <h1
        style={{
          fontSize: "24px",
          fontWeight: 600,
          marginBottom: "16px",
        }}
      >
        Company Budget Decision Test
      </h1>

      <p style={{ marginBottom: "12px" }}>
        This page tests the real company-budget decision flow using Shopify
        Company and CompanyLocation metafields.
      </p>

      <p style={{ marginBottom: "12px" }}>
        Try different order totals by changing the URL:
      </p>

      <ul style={{ marginBottom: "16px", paddingLeft: "20px" }}>
        <li>
          <code>/app/company-budget-decision-test?orderTotal=4000</code>
        </li>
        <li>
          <code>/app/company-budget-decision-test?orderTotal=5000</code>
        </li>
        <li>
          <code>/app/company-budget-decision-test?orderTotal=6000</code>
        </li>
      </ul>

      <pre
        style={{
          background: "#f6f6f7",
          padding: "16px",
          borderRadius: "8px",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
