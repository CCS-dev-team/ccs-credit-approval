/**
 * POST /apps/quotes/request   (Shopify app proxy -> /apps/quotes/request)
 *
 * Receives the cart + contact details from the storefront, re-prices every
 * line from the Admin API, and emails sales@ a structured quote request.
 *
 * Deliberately stores nothing: the email is the record. Add a DB insert
 * here when you want reporting.
 */
import crypto from "node:crypto";
import { unauthenticated } from "../shopify.server";

/**
 * Portable across Remix and React Router 7: no framework import, so this
 * works whichever one the repo uses. Returns a plain Response.
 */
type RouteArgs = { request: Request };

const json = (body: unknown, init?: number | ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: typeof init === "number" ? init : init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(typeof init === "object" ? init.headers : {}) },
  });

const FROM_EMAIL = process.env.QUOTE_FROM_EMAIL ?? "quotes@centralcleaning.com.au";
const FROM_NAME = "Central Cleaning Supplies — Quotes";
const SALES_EMAIL = process.env.QUOTE_SALES_EMAIL ?? "sales@centralcleaning.com.au";
const BCC_EMAIL = process.env.QUOTE_BCC_EMAIL ?? "lee@centralcleaning.com.au";
const APP_SECRET = process.env.SHOPIFY_APP_SECRET;

type IncomingItem = { id: number; key?: string; quantity: number };

type PricedLine = {
  sku: string;
  title: string;
  variantTitle: string;
  grams: number;
  quantity: number;
  unitPrice: number;   // ex-GST, shop currency
  lineTotal: number;
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

const money = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);

function reference() {
  const y = new Date().getFullYear().toString().slice(-2);
  // 5 base36 chars of entropy — collision-safe at quote volumes, human-readable
  const tail = crypto.randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
  return `Q-${y}-${tail}`;
}

async function adminGraphql<T>(
  shop: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors) {
    throw new Error(`admin_graphql_error: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  return body.data as T;
}

/** Re-price the submitted lines from Shopify. Never trusts client prices. */
async function priceLines(items: IncomingItem[], shop: string): Promise<PricedLine[]> {
  const ids = items.map((i) => `gid://shopify/ProductVariant/${i.id}`);
  const data = await adminGraphql<{
    nodes: Array<{
      id: string;
      sku: string | null;
      title: string;
      price: string;
      product: { title: string; featuredImage: { url: string } | null };
    } | null>;
  }>(
    shop,
    `query Variants($ids: [ID!]!) {
       nodes(ids: $ids) {
         ... on ProductVariant {
           id
           sku
           title
           price
           product { title featuredImage { url } }
         }
       }
     }`,
    { ids }
  );

  const byId = new Map<string, NonNullable<(typeof data.nodes)[number]>>();
  for (const n of data.nodes ?? []) if (n) byId.set(n.id, n);

  const lines: PricedLine[] = [];
  for (const item of items) {
    const v = byId.get(`gid://shopify/ProductVariant/${item.id}`);
    if (!v) continue; // variant gone — keep the line count honest by skipping

    const unit = parseFloat(v.price);
    lines.push({
      sku: v.sku ?? "—",
      title: v.product.title,
      variantTitle: v.title === "Default Title" ? "" : v.title,
      grams: 0,
      quantity: item.quantity,
      unitPrice: unit,
      lineTotal: unit * item.quantity,
    });
  }
  return lines;
}


/**
 * Verify the Shopify app proxy signature.
 *
 * Shopify signs the query string with the app's shared secret:
 * sort the params (excluding `signature`), join as key=value with no
 * separator, HMAC-SHA256 with the secret, compare hex.
 *
 * Without this, anyone who finds the endpoint can post arbitrary email
 * through your SendGrid account.
 */
function verifyProxySignature(url: URL, secret: string): boolean {
  const provided = url.searchParams.get("signature");
  if (!provided) return false;

  const pairs: string[] = [];
  const keys: string[] = [];
  url.searchParams.forEach((_v, k) => {
    if (k !== "signature") keys.push(k);
  });

  for (const k of keys.sort()) {
    const values = url.searchParams.getAll(k);
    pairs.push(`${k}=${values.join(",")}`);
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(pairs.join(""))
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* email                                                               */
/* ------------------------------------------------------------------ */

function buildHtml(args: {
  ref: string;
  lines: PricedLine[];
  email: string;
  phone: string;
  name: string;
  company: string;
  note: string;
  accountNumber?: string;
  isLoggedIn: boolean;
  cartPermalink: string;
  subtotal: number;
  gst: number;
  total: number;
}) {
  const rows = args.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ecea;font:12px/1.4 Helvetica,Arial,sans-serif;color:#1c2b2f;white-space:nowrap">${esc(l.sku)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ecea;font:12px/1.4 Helvetica,Arial,sans-serif;color:#1c2b2f">
          ${esc(l.title)}${l.variantTitle ? `<br><span style="color:#5d7075;font-size:11px">${esc(l.variantTitle)}</span>` : ""}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ecea;font:12px/1.4 Helvetica,Arial,sans-serif;color:#1c2b2f;text-align:center">${l.quantity}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ecea;font:12px/1.4 Helvetica,Arial,sans-serif;color:#1c2b2f;text-align:right;white-space:nowrap">${money(l.unitPrice)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ecea;font:12px/1.4 Helvetica,Arial,sans-serif;color:#1c2b2f;text-align:right;white-space:nowrap">${money(l.lineTotal)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f7f6">
  <table role="presentation" width="100%" style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #dfe6e5">
    <tr><td style="padding:20px 24px;border-bottom:3px solid #0b6b63">
      <div style="font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#0b6b63">Quote request</div>
      <div style="font:400 20px/1.3 Georgia,serif;color:#1c2b2f;margin-top:6px">${esc(args.ref)} — ${esc(args.company || args.name)}</div>
      <div style="font:12px/1.5 Helvetica,Arial,sans-serif;color:#5d7075;margin-top:4px">${args.lines.length} line${args.lines.length === 1 ? "" : "s"} · submitted ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" })} AEST</div>
    </td></tr>

    <tr><td style="padding:18px 24px">
      <table role="presentation" width="100%" style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#1c2b2f">
        <tr><td style="width:110px;color:#5d7075">Name</td><td>${esc(args.name)}</td></tr>
        <tr><td style="color:#5d7075">Company</td><td>${esc(args.company) || "—"}</td></tr>
        <tr><td style="color:#5d7075">Email</td><td><a href="mailto:${esc(args.email)}" style="color:#0b6b63">${esc(args.email)}</a></td></tr>
        <tr><td style="color:#5d7075">Phone</td><td><a href="tel:${esc(args.phone)}" style="color:#0b6b63">${esc(args.phone)}</a></td></tr>
        <tr><td style="color:#5d7075">Account</td><td>${args.isLoggedIn ? `Logged in${args.accountNumber ? ` · ${esc(args.accountNumber)}` : ""}` : "Guest — not logged in"}</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:0 24px 8px">
      <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #dfe6e5">
        <tr>
          <th align="left"  style="padding:10px;border-bottom:1px solid #dfe6e5;font:600 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5d7075">SKU</th>
          <th align="left"  style="padding:10px;border-bottom:1px solid #dfe6e5;font:600 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5d7075">Product</th>
          <th align="center"style="padding:10px;border-bottom:1px solid #dfe6e5;font:600 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5d7075">Qty</th>
          <th align="right" style="padding:10px;border-bottom:1px solid #dfe6e5;font:600 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5d7075">Unit ex GST</th>
          <th align="right" style="padding:10px;border-bottom:1px solid #dfe6e5;font:600 10px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5d7075">Line</th>
        </tr>
        ${rows}
      </table>
    </td></tr>

    <tr><td style="padding:10px 24px 0">
      <table role="presentation" width="100%" style="font:12px/1.9 Helvetica,Arial,sans-serif;color:#1c2b2f">
        <tr><td align="right" style="color:#5d7075">Subtotal ex GST</td><td align="right" width="110">${money(args.subtotal)}</td></tr>
        <tr><td align="right" style="color:#5d7075">GST 10%</td><td align="right">${money(args.gst)}</td></tr>
        <tr><td align="right" style="font-weight:600;border-top:1px solid #dfe6e5;padding-top:6px">Total inc GST</td><td align="right" style="font-weight:600;border-top:1px solid #dfe6e5;padding-top:6px">${money(args.total)}</td></tr>
      </table>
      <p style="margin:10px 0 0;font:11px/1.5 Helvetica,Arial,sans-serif;color:#8a9a9d">Catalogue prices shown. The quoted price may differ.</p>
    </td></tr>

    ${
      args.note
        ? `<tr><td style="padding:18px 24px 0">
             <div style="border-left:3px solid #0b6b63;background:#f5f8f7;padding:10px 14px;font:12px/1.6 Helvetica,Arial,sans-serif;color:#1c2b2f;white-space:pre-wrap">${esc(args.note)}</div>
           </td></tr>`
        : ""
    }

    <tr><td style="padding:18px 24px 22px">
      <a href="${esc(args.cartPermalink)}" style="display:inline-block;padding:10px 16px;background:#0b6b63;color:#fff;text-decoration:none;font:600 12px/1 Helvetica,Arial,sans-serif;border-radius:2px">Open this cart</a>
      <p style="margin:14px 0 0;font:11px/1.5 Helvetica,Arial,sans-serif;color:#5d7075">Reply to this email to respond directly to the customer.</p>
    </td></tr>
  </table></body></html>`;
}

/* ------------------------------------------------------------------ */
/* GET — used to verify the app proxy is wired correctly               */
/* ------------------------------------------------------------------ */

export async function loader() {
  return json(
    {
      ok: false,
      error: "method_not_allowed",
      hint: "This endpoint only accepts POST from the storefront. A 405 here means the app proxy is wired correctly.",
    },
    405
  );
}

/* ------------------------------------------------------------------ */
/* action                                                              */
/* ------------------------------------------------------------------ */

export async function action({ request }: RouteArgs) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });

  const url = new URL(request.url);

  // ---- app proxy signature (fail closed) ----
  if (!APP_SECRET) {
    console.error("[quote] SHOPIFY_APP_SECRET is not set");
    return json({ error: "not_configured" }, { status: 503 });
  }
  if (!verifyProxySignature(url, APP_SECRET)) {
    console.warn("[quote] rejected request with bad proxy signature");
    return json({ error: "invalid_signature" }, { status: 401 });
  }

  // App proxy passes the signed logged-in customer id and the shop
  const proxyCustomerId = url.searchParams.get("logged_in_customer_id");
  const shop = url.searchParams.get("shop") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    console.warn("[quote] missing or invalid shop param", shop);
    return json({ error: "invalid_shop" }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, { status: 400 });
  }

  const email = String(body?.email ?? "").trim();
  const phone = String(body?.phone ?? "").trim();
  const name = String(body?.name ?? "").trim();
  const company = String(body?.company ?? "").trim();
  const note = String(body?.note ?? "").slice(0, 2000);
  const items: IncomingItem[] = Array.isArray(body?.cart?.items) ? body.cart.items : [];

  // ---- validation ----
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "invalid_email" }, { status: 422 });
  if (phone.replace(/\D/g, "").length < 8) return json({ error: "invalid_phone" }, { status: 422 });
  if (!items.length) return json({ error: "empty_cart" }, { status: 422 });
  if (items.length > 200) return json({ error: "too_many_lines" }, { status: 422 });
  if (!proxyCustomerId && !name) return json({ error: "name_required" }, { status: 422 });

  let lines: PricedLine[];
  try {
    lines = await priceLines(items, shop);
  } catch (err) {
    console.error("[quote] pricing failed", err);
    return json({ error: "pricing_unavailable" }, { status: 503 });
  }
  if (!lines.length) return json({ error: "no_quotable_lines" }, { status: 422 });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const gst = Math.round(subtotal * 0.1 * 100) / 100;
  const total = Math.round((subtotal + gst) * 100) / 100;
  const ref = reference();

  const storefront = process.env.STOREFRONT_URL ?? "https://www.centralcleaningsupplies.com.au";
  const permalink =
    storefront + "/cart/" + items.map((i) => `${i.id}:${i.quantity}`).join(",");

  const html = buildHtml({
    ref,
    lines,
    email,
    phone,
    name,
    company,
    note,
    isLoggedIn: Boolean(proxyCustomerId),
    cartPermalink: permalink,
    subtotal,
    gst,
    total,
  });

  const subject = `Quote request ${ref} — ${company || name} — ${lines.length} line${lines.length === 1 ? "" : "s"}`;

  // ---- send via SendGrid ----
  const sendRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: SALES_EMAIL }],
          bcc: [{ email: BCC_EMAIL }],
          // reply straight to the buyer
          custom_args: { quote_ref: ref },
        },
      ],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email, name: name || undefined },
      subject,
      content: [{ type: "text/html", value: html }],
      tracking_settings: {
        click_tracking: { enable: false },  // would rewrite the cart permalink
        open_tracking: { enable: false },   // noise on an internal email
      },
      categories: ["quote-request"],
    }),
  });

  if (!sendRes.ok) {
    const detail = await sendRes.text().catch(() => "");
    console.error("[quote] sendgrid failed", sendRes.status, detail.slice(0, 500));
    return json({ error: "send_failed" }, { status: 502 });
  }

  // Customer acknowledgement — Reply-To is sales@ so replies land in the inbox
  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      reply_to: { email: SALES_EMAIL },
      subject: `We've got your quote request ${ref}`,
      content: [
        {
          type: "text/plain",
          value:
            `Thanks ${name || "for your enquiry"} — we've received your quote request ${ref} ` +
            `for ${lines.length} line${lines.length === 1 ? "" : "s"}.\n\n` +
            `Our team will reply within one business day with pricing, freight and lead times.\n\n` +
            `If anything changes, just reply to this email.\n\n` +
            `Central Cleaning Supplies`,
        },
      ],
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking: { enable: false },
      },
      categories: ["quote-request-ack"],
    }),
  }).catch((e) => console.error("[quote] ack failed", e));

  return json({ ok: true, reference: ref, lines: lines.length });
}