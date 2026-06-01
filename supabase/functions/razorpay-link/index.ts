// Supabase Edge Function: razorpay-link (SALT-108)
//
// Creates a Razorpay payment link. Holds the Razorpay key id + secret
// server-side and Basic-auths to the Razorpay API, so the secret never reaches
// the client (lib/razorpay.ts only knows this function's URL). The request body
// is the Payment Links payload built by buildPaymentLinkRequest().
//
// Deploy:
//   supabase functions deploy razorpay-link
// Secrets:
//   supabase secrets set RAZORPAY_KEY_ID=<rzp_live_or_test_id>
//   supabase secrets set RAZORPAY_KEY_SECRET=<key-secret>
//
// Webhook → ledger auto-reconciliation is a separate function/ticket; this one
// only creates links.

const RAZORPAY_API = "https://api.razorpay.com/v1/payment_links";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// @ts-expect-error — Deno is the edge runtime global (not in the web tsconfig).
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Require a Supabase session JWT so only signed-in staff can create links.
  if (!req.headers.get("Authorization")) return json({ error: "Missing Authorization" }, 401);

  // @ts-expect-error — Deno.env is provided by the edge runtime.
  const keyId: string | undefined = Deno.env.get("RAZORPAY_KEY_ID");
  // @ts-expect-error — Deno.env is provided by the edge runtime.
  const keySecret: string | undefined = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    return json({ error: { description: "Razorpay not configured on the server" } }, 500);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: { description: "Invalid JSON body" } }, 400);
  }

  const res = await fetch(RAZORPAY_API, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
