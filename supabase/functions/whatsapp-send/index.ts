// Supabase Edge Function: whatsapp-send (SALT-107)
//
// Holds the WhatsApp Business (Cloud) API credentials server-side and forwards
// a pre-built Graph API message payload from the web client (lib/whatsapp.ts).
// The web client only ever calls this when the owner ticks "Send via WhatsApp
// Business API" in Settings → Integrations → WhatsApp; otherwise it uses the
// click-to-chat (wa.me) link and never touches this function.
//
// Deploy:
//   supabase functions deploy whatsapp-send
// Secrets (never shipped to the client):
//   supabase secrets set WHATSAPP_TOKEN=<permanent-access-token>
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>
//
// The body is the Graph API message object (see buildTextPayload /
// buildTemplatePayload in lib/whatsapp.ts) — this function just adds auth and
// forwards, so the message shape stays defined in one place.

const GRAPH_VERSION = "v21.0";

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

  // Require a Supabase session JWT so only signed-in staff can send.
  if (!req.headers.get("Authorization")) return json({ error: "Missing Authorization" }, 401);

  // @ts-expect-error — Deno.env is provided by the edge runtime.
  const token: string | undefined = Deno.env.get("WHATSAPP_TOKEN");
  // @ts-expect-error — Deno.env is provided by the edge runtime.
  const phoneNumberId: string | undefined = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    return json({ error: "WhatsApp Business API not configured on the server" }, 500);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
