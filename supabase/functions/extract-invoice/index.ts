// Edge Function: extract-invoice (SALT-027)
//
// OCR/vision extraction of a distributor purchase invoice into structured rows.
// The client sends one file inline (base64 + mime); we ask Google Gemini to return
// STRICT JSON of the invoice header + line items, and hand it back. The shape
// mirrors the CSV importer's columns (lib/importPurchaseInvoice.ts), so the
// frontend can feed the result straight into the existing parse → review → post
// (receive_purchase) flow — no duplicate posting logic.
//
// DEPLOY (user/infra — the agent cannot do this):
//   supabase functions deploy extract-invoice
//   supabase secrets set GEMINI_API_KEY=AIza...   # vision key, server-side only
// Optional overrides: OCR_MODEL (default gemini-2.0-flash).
//
// Auth: requires the caller's Supabase JWT (verify_jwt defaults on). The vision
// key never leaves the server. No Storage bucket — the file is processed inline.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("OCR_MODEL") ?? "gemini-2.0-flash";

/** The columns the CSV importer understands (PURCHASE_IMPORT_COLUMNS). The model
 *  is told to use exactly these keys per line so the client maps 1:1. */
const PROMPT = `You are extracting an Indian pharmaceutical distributor's purchase invoice.
Return ONLY valid JSON (no prose, no markdown fence) of this exact shape:
{
  "invoice_no": string,
  "date": string,            // as printed, prefer DD-MM-YYYY or YYYY-MM-DD
  "vendor": string,          // distributor/seller name
  "vendor_gstin": string,    // 15-char GSTIN if present, else ""
  "lines": [
    {
      "item_name": string,
      "item_code": string,   // vendor product code if any, else ""
      "hsn": string,
      "batch_no": string,
      "expiry": string,      // MM/YYYY or YYYY-MM if present, else ""
      "qty": number,
      "free_qty": number,    // scheme free units, else 0
      "ptr": number,         // price to retailer per unit (rupees, tax-exclusive)
      "mrp": number,         // printed MRP per unit (rupees), else 0
      "gst_rate": number,    // % (0/5/12/18), use the line's IGST or CGST+SGST sum
      "discount_pct": number // trade discount %, else 0
    }
  ]
}
Rules: numbers are plain (no currency symbols/commas). If a field is absent use ""
for strings and 0 for numbers. Do NOT invent lines; transcribe only what is printed.
Money is per-unit in rupees, not paise.`;

/**
 * Call Gemini's generateContent with the file inline. PDFs and images both use the
 * same `inline_data` part (unlike Anthropic's document-vs-image split), and
 * `responseMimeType: application/json` makes the model emit bare JSON.
 */
async function callGemini(key: string, b64: string, mime: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mime, data: b64 } },
          { text: PROMPT },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  // generateContent → candidates[].content.parts[].text; concatenate the text parts.
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) {
    // A blocked prompt (safety) or empty candidate has no text — surface it clearly.
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no text${reason ? ` (${reason})` : ""}`);
  }
  return text;
}

/** Pull the first JSON object out of the model's reply, tolerating stray fencing.
 *  With responseMimeType=application/json Gemini returns bare JSON, but we stay
 *  defensive in case a model/version wraps it. */
function parseModelJson(raw: string): unknown {
  const fence = raw.replace(/```json\s*|\s*```/g, "");
  const start = fence.indexOf("{");
  const end = fence.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model did not return JSON");
  return JSON.parse(fence.slice(start, end + 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...CORS, "content-type": "application/json" } });
  }

  const key = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("OCR_API_KEY");
  if (!key) {
    // Distinct signal so the client can show "OCR not configured" rather than a generic error.
    return new Response(JSON.stringify({ error: "ocr_not_configured" }), { status: 501, headers: { ...CORS, "content-type": "application/json" } });
  }

  try {
    const { file_base64, mime } = await req.json();
    if (!file_base64 || !mime) {
      return new Response(JSON.stringify({ error: "file_base64 and mime required" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    }
    const text = await callGemini(key, file_base64, mime);
    const json = parseModelJson(text);
    return new Response(JSON.stringify(json), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "extraction failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
