import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ShopifyBudgetProvider } from "../services/shopify-budget-provider.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  // Customer access is currently blocked in the dev-store flow by protected customer data restrictions.
  // Keep this as a diagnostic page for now.
  const customerId = "gid://shopify/Customer/9594610811019";

  const provider = new ShopifyBudgetProvider(admin);
  const result = await provider.getCustomerCredit(customerId);

  return Response.json({
    ok: true,
    customerId,
    result,
  });
}

export default function CustomerCreditTestPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "24px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "16px" }}>
        Customer Credit Test
      </h1>
      <p style={{ marginBottom: "16px" }}>
        Result from Shopify customer metafield lookup:
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
