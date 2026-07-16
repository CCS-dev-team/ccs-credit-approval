import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ShopifyBudgetProvider } from "../services/shopify-budget-provider.server";
import { createRequestLogger } from "../lib/request-logger.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const log = createRequestLogger(request);
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId");

  if (!customerId) {
    return Response.json(
      {
        ok: false,
        error: "Missing customerId query parameter",
        example:
          "/api/customer-credit-test?customerId=gid://shopify/Customer/1234567890",
      },
      { status: 400 },
    );
  }

  const provider = new ShopifyBudgetProvider(admin);
  const result = await provider.getCustomerCredit(customerId);

  log.info(
    {
      event: "customer.credit.test",
      customerId,
      result,
    },
    "Customer credit test completed",
  );

  return Response.json({
    ok: true,
    customerId,
    result,
  });
}