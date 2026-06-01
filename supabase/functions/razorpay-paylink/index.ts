// razorpay-paylink — create a Razorpay Payment Link for a party + amount (SALT-169).
//
// Called by the authenticated Payments client. The Razorpay key SECRET stays
// server-side (never reaches the browser). The caller's JWT scopes the party
// lookup through RLS, so a user can only bill their own org's parties.
//
// Request  (POST, JSON): { party_id: uuid, amount_paise: number, description?: string }
// Response (200, JSON):  { short_url: string, id: string }
//
// Secrets (Supabase → Project Settings → Edge Functions):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
// SUPABASE_URL / SUPABASE_ANON_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization" }, 401);

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return json({ error: "Razorpay keys not configured" }, 500);

  let body: { party_id?: string; amount_paise?: number; description?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const partyId = body.party_id;
  const amountPaise = Math.round(Number(body.amount_paise));
  if (!partyId) return json({ error: "party_id is required" }, 400);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return json({ error: "amount_paise must be a positive integer" }, 400);

  // Caller-scoped client: RLS limits the party lookup to the user's org.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: party, error } = await supabase
    .from("ledgers")
    .select("name, phone, org_id")
    .eq("id", partyId)
    .single();
  if (error || !party) return json({ error: "party not found" }, 404);

  // Razorpay amounts are in paise — same unit we store, so pass straight through.
  const rzpBody = {
    amount: amountPaise,
    currency: "INR",
    description: body.description ?? `Payment to ${party.name ?? "shop"}`,
    customer: { name: party.name ?? undefined, contact: party.phone ?? undefined },
    notify: { sms: Boolean(party.phone), email: false },
    reminder_enable: true,
    notes: { party_id: partyId, org_id: party.org_id },
  };
  const rzpRes = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rzpBody),
  });
  const rzp = await rzpRes.json();
  if (!rzpRes.ok) {
    return json({ error: "razorpay error", detail: rzp?.error?.description ?? rzp }, 502);
  }
  return json({ short_url: rzp.short_url, id: rzp.id });
});
