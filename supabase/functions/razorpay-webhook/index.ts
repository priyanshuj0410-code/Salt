// razorpay-webhook — verify Razorpay's HMAC and auto-apply the receipt (SALT-169).
//
// Razorpay POSTs here on payment events. There is NO Supabase JWT, so this
// function must be deployed with verify_jwt = false (see supabase/config.toml)
// and authenticates the request itself via the X-Razorpay-Signature HMAC.
// On a paid event it calls record_gateway_payment (service-role, idempotent on
// the Razorpay payment id) so a re-delivered webhook never double-posts.
//
// Secrets: RAZORPAY_WEBHOOK_SECRET (set when creating the webhook in Razorpay).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const enc = new TextEncoder();

// HMAC-SHA256(raw, secret) as lowercase hex, constant-time compared to the header.
async function validSignature(raw: string, signature: string, secret: string): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return new Response("webhook secret not configured", { status: 500 });

  // Must verify the HMAC over the RAW body (not a re-serialized object).
  const raw = await req.text();
  const signature = req.headers.get("X-Razorpay-Signature") ?? "";
  if (!(await validSignature(raw, signature, secret))) {
    return new Response("invalid signature", { status: 401 });
  }

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Only act on a captured/paid payment; ack everything else so Razorpay stops.
  if (evt.event !== "payment_link.paid" && evt.event !== "payment.captured") {
    return new Response(JSON.stringify({ ignored: evt.event }), { status: 200 });
  }

  const pay = evt.payload?.payment?.entity;
  const link = evt.payload?.payment_link?.entity;
  const notes = pay?.notes ?? link?.notes ?? {};
  const orgId = notes.org_id;
  const partyId = notes.party_id;
  const amountPaise = pay?.amount ?? link?.amount; // Razorpay amounts are paise
  const gatewayRef = pay?.id ?? link?.id;

  // Can't attribute without our notes — ack (200) so Razorpay doesn't retry forever.
  if (!orgId || !partyId || !gatewayRef || !amountPaise) {
    return new Response(JSON.stringify({ ignored: "unattributable", ref: gatewayRef ?? null }), { status: 200 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await admin.rpc("record_gateway_payment", {
    p_org_id: orgId,
    p_party_id: partyId,
    p_amount_paise: amountPaise,
    p_gateway: "razorpay",
    p_gateway_ref: gatewayRef,
    p_reference: pay?.id ?? null,
  });
  if (error) {
    // 500 → Razorpay retries later (transient DB issue). Idempotency makes retry safe.
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true, ref: gatewayRef }), { status: 200 });
});
