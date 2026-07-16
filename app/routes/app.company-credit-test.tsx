import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ShopifyBudgetProvider } from "../services/shopify-budget-provider.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const companyId = "gid://shopify/Company/168036368695";
  const companyLocationId = "gid://shopify/CompanyLocation/172949635383";

  const provider = new ShopifyBudgetProvider(admin);

  const companyCredit = await provider.getCompanyCredit(companyId);
  const approverEmail = await provider.getCompanyLocationApprover(companyLocationId);

  return Response.json({
    ok: true,
    companyId,
    companyLocationId,
    companyCredit,
    approverEmail,
  });
}

export default function CompanyCreditTestPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "24px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "16px" }}>
        Company Credit Test
      </h1>
      <p style={{ marginBottom: "16px" }}>
        Result from Shopify company and company location metafield lookup:
      </p>
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