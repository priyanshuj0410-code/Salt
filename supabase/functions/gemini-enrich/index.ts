// Edge Function: gemini-enrich (SALT — AI item enrichment)
//
// Given a brand name + manufacturer, ask Google Gemini for the drug's identity
// (salt/composition, therapeutic category, HSN, GST rate, schedule) as STRICT JSON.
// The item edit page (ItemDetailPage) calls this to fill EMPTY / placeholder fields
// for the user to review before saving — it never writes to the DB itself.
//
// This is the AI fallback for items the free, deterministic paths (brand_aliases +
// master_items via "Fill from master") cannot resolve. Reuses the same GEMINI_API_KEY
// secret as extract-invoice, and the same model-chain + retry pattern.
//
// DEPLOY (user/infra — the agent cannot do this):
//   supabase functions deploy gemini-enrich
//   supabase secrets set GEMINI_API_KEY=AIza...   # already set for extract-invoice — reused
//
// Auth: requires the caller's Supabase JWT (verify_jwt defaults on). The key never
// leaves the server. Compliance note: HSN / GST / schedule are AI suggestions — the
// page surfaces them for review; a pharmacist should confirm schedule before relying on it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Model fallback chain (independent capacity) — overridable via ENRICH_MODEL.
const MODELS = (Deno.env.get("ENRICH_MODEL") ?? "gemini-flash-latest,gemini-2.5-flash,gemini-2.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

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

const RETRYABLE = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

class TransientModelError extends Error {}

async function fetchModel(model: string, key: string, payload: string): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
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

async function callGemini(key: string, name: string, manufacturer: string): Promise<string> {
  const ask = `Brand: ${name}\nManufacturer: ${manufacturer || "(unknown)"}`;
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: `${PROMPT}\n\n${ask}` }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  let res: Response | null = null;
  let transientDetail = "";
  for (const model of MODELS) {
    try {
      const r = await fetchModel(model, key, payload);
      if (r.ok) {
        res = r;
        break;
      }
      const detail = await r.text();
      if (r.status === 404 && MODELS.indexOf(model) < MODELS.length - 1) continue;
      throw new Error(`Gemini API ${r.status}: ${detail.slice(0, 300)}`);
    } catch (e) {
      if (e instanceof TransientModelError) {
        transientDetail = e.message;
        continue;
      }
      throw e;
    }
  }
  if (!res) throw new Error(`Gemini API 503: all models busy (${MODELS.join(", ")}). Last: ${transientDetail}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ""}`);
  }
  return text;
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

  const key = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("OCR_API_KEY");
  if (!key) return json({ error: "ai_not_configured" }, 501);

  try {
    const { name, manufacturer } = await req.json();
    if (!name || typeof name !== "string") return json({ error: "name required" }, 400);
    const text = await callGemini(key, name, typeof manufacturer === "string" ? manufacturer : "");
    return json(normalize(parseModelJson(text)));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "enrichment failed" }, 500);
  }
});
