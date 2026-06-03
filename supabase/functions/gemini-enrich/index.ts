// Edge Function: gemini-enrich (SALT — AI item enrichment) — Ollama Cloud (Gemma) provider.
//
// Given a brand name + manufacturer, ask an Ollama-hosted Gemma model for the drug's
// identity (salt/composition, therapeutic category, HSN, GST rate, schedule) as STRICT
// JSON. The item edit page (ItemDetailPage) calls this to fill EMPTY / placeholder fields
// for the user to review before saving — it never writes to the DB itself.
//
// The function name stays "gemini-enrich" (so the client invoke + the deployed function are
// unchanged), but it now calls Ollama, not Gemini — same OLLAMA_API_KEY as extract-invoice.
//
// DEPLOY (user/infra — the agent cannot do this):
//   supabase functions deploy gemini-enrich
//   supabase secrets set OLLAMA_API_KEY=...     # Ollama Cloud key — already set for extract-invoice
// Optional: ENRICH_MODEL (default "gemma4:31b-cloud"), OLLAMA_HOST (default https://ollama.com).
//
// Auth: requires the caller's Supabase JWT (verify_jwt defaults on — the authenticated item
// page calls it). The key never leaves the server. Compliance note: HSN / GST / schedule are
// AI suggestions — the page surfaces them for review; a pharmacist should confirm schedule.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OLLAMA_HOST = (Deno.env.get("OLLAMA_HOST") ?? "https://ollama.com").replace(/\/+$/, "");
const MODELS = (Deno.env.get("ENRICH_MODEL") ?? "gemma4:31b-cloud")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const NUM_CTX = Number(Deno.env.get("OLLAMA_NUM_CTX")) || 8192;
const NUM_PREDICT = Number(Deno.env.get("OLLAMA_NUM_PREDICT")) || 2048;

const PROMPT = `You are a reference for Indian pharmaceutical and medical-retail products.
Given a product BRAND name and its MANUFACTURER, identify the product and return ONLY
valid JSON (no prose, no markdown fence) of this exact shape:
{
  "salt": string,                 // active molecule(s) + strength, e.g. "Paracetamol 650mg" or "Amoxicillin 500mg + Clavulanic Acid 125mg". "" if unsure.
  "therapeutic_category": string, // drug / therapeutic class, e.g. "Antidiabetic", "Antibiotic (Macrolide)". "" if unsure.
  "hsn": string,                  // GST HSN code. Most finished medicines are "3004"; dressings "3005"; surgical sutures/diagnostics "3006"; instruments/devices "9018"/"9021"; oral care/cosmetics "3306"/"3304"; nutraceuticals/food supplements "2106". "" if unsure.
  "gst_rate": number,             // GST percent, exactly one of 0, 5, 12, 18. 0 if unsure.
  "schedule": string,             // Drugs & Cosmetics schedule, one of "OTC","H","H1","X". "OTC" if general sale / unsure.
  "confidence": string            // "high" | "medium" | "low" — your certainty about the salt
}
Rules: use the manufacturer to disambiguate same-named brands across companies. Do NOT
invent a molecule you are unsure of — set "salt":"" and "confidence":"low" instead.
Numbers are plain (no % sign). Use Indian market context (NLEM, common Indian brands).`;

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/** Thrown when a model exhausts its retries on a transient error — fall to the next model. */
class TransientModelError extends Error {}

interface ChatMessage {
  role: "user";
  content: string;
}

/** POST /api/chat with backoff retry on transient (429/5xx). */
async function fetchChat(key: string, payload: string): Promise<Response> {
  const url = `${OLLAMA_HOST}/api/chat`;
  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: payload,
    });
    if (res.ok || !RETRYABLE.has(res.status)) return res;
    lastDetail = await res.text();
    if (attempt === MAX_ATTEMPTS) throw new TransientModelError(`${res.status}: ${lastDetail.slice(0, 200)}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new TransientModelError(lastDetail.slice(0, 200));
}

async function onceOverChain(
  key: string,
  messages: ChatMessage[],
  think: boolean | undefined,
): Promise<{ res?: Response; rejectedThink?: boolean; transient?: string }> {
  let transient = "";
  for (const model of MODELS) {
    const body = JSON.stringify({
      model,
      messages,
      stream: false,
      format: "json",
      ...(think === undefined ? {} : { think }),
      options: { temperature: 0, num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
    });
    try {
      const r = await fetchChat(key, body);
      if (r.ok) return { res: r };
      const detail = await r.text();
      if (think !== undefined && /think/i.test(detail)) return { rejectedThink: true };
      if (r.status === 404 && MODELS.indexOf(model) < MODELS.length - 1) continue;
      throw new Error(`Ollama API ${r.status}: ${detail.slice(0, 300)}`);
    } catch (e) {
      if (e instanceof TransientModelError) {
        transient = e.message;
        continue;
      }
      throw e;
    }
  }
  return { transient };
}

/** Send a chat and return the model's text content (think:false → JSON directly; drop on reject). */
async function callOllama(key: string, name: string, manufacturer: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "user", content: `${PROMPT}\n\nBrand: ${name}\nManufacturer: ${manufacturer || "(unknown)"}` },
  ];
  let out = await onceOverChain(key, messages, false);
  if (out.rejectedThink) out = await onceOverChain(key, messages, undefined);
  if (!out.res) {
    throw new Error(`Ollama API unavailable (${MODELS.join(", ")})${out.transient ? `. Last: ${out.transient}` : ""}`);
  }
  const data = await out.res.json();
  const content = typeof data?.message?.content === "string" ? data.message.content : "";
  if (!content) throw new Error(`Ollama returned no content${data?.error ? `: ${data.error}` : ""}`);
  return content;
}

function parseModelJson(raw: string): Record<string, unknown> {
  const fence = raw.replace(/```json\s*|\s*```/g, "");
  const start = fence.indexOf("{");
  const end = fence.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model did not return JSON");
  return JSON.parse(fence.slice(start, end + 1));
}

/** Coerce the model output to our exact field shape — clamp GST + schedule to valid sets. */
function normalize(j: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const gst = Number(j.gst_rate);
  const sched = str(j.schedule).toUpperCase();
  const conf = str(j.confidence).toLowerCase();
  return {
    salt: str(j.salt),
    therapeutic_category: str(j.therapeutic_category),
    hsn: str(j.hsn).replace(/[^0-9]/g, ""),
    gst_rate: [0, 5, 12, 18].includes(gst) ? gst : 0,
    schedule: ["OTC", "H", "H1", "X"].includes(sched) ? sched : "OTC",
    confidence: ["high", "medium", "low"].includes(conf) ? conf : "low",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("OLLAMA_API_KEY") ?? Deno.env.get("OCR_API_KEY");
  if (!key) return json({ error: "ai_not_configured" }, 501);

  try {
    const { name, manufacturer } = await req.json();
    if (!name || typeof name !== "string") return json({ error: "name required" }, 400);
    const text = await callOllama(key, name, typeof manufacturer === "string" ? manufacturer : "");
    return json(normalize(parseModelJson(text)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "enrichment failed" }, 500);
  }
});
