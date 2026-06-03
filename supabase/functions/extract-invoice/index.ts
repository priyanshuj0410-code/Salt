// Edge Function: extract-invoice (SALT-027) — Ollama Cloud (Gemma) provider.
//
// OCR/vision extraction of a distributor purchase invoice into structured rows. The
// client sends one file inline (base64 + mime); we ask an Ollama-hosted Gemma model to
// return STRICT JSON of the invoice header + line items. The shape mirrors the CSV
// importer's columns (lib/importPurchaseInvoice.ts), so the frontend feeds the result
// straight into the existing parse → review → post (receive_purchase) flow.
//
// File routing (Gemma vision reads IMAGES, not PDFs — mirrors the local worker's extract.ts):
//   • CSV / text export        → text message
//   • image (jpg/png)          → vision (base64 in `images`)
//   • PDF with a text layer     → text message (unpdf extractText — no vision, exact, cheap)
//   • scanned PDF (no text)     → rasterize pages → vision  (mupdf wasm)
// The two PDF libraries are dynamic-imported ONLY inside the PDF branch, so CSV/image
// requests never load them and a wasm hiccup can't break the whole function.
//
// DEPLOY (user/infra — the agent cannot do this):
//   supabase functions deploy extract-invoice
//   supabase secrets set OLLAMA_API_KEY=...        # Ollama Cloud key (ollama.com → Keys)
// Optional secrets: OCR_MODEL (default "gemma4:31b-cloud"; comma-separated for a chain),
//   OLLAMA_HOST (default https://ollama.com), OLLAMA_NUM_CTX (8192), OLLAMA_NUM_PREDICT (4096).
//
// Auth: verify_jwt is OFF for this function (config.toml) so the process-scans worker can
// call it with the service-role key; it's still gated by the required apikey. The Ollama
// key never leaves the server.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OLLAMA_HOST = (Deno.env.get("OLLAMA_HOST") ?? "https://ollama.com").replace(/\/+$/, "");
// Model chain: OCR_MODEL overrides (comma-separated for a custom order / single id to pin).
const MODELS = (Deno.env.get("OCR_MODEL") ?? "gemma4:31b-cloud")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
// numCtx MUST exceed (input + numPredict): if generation overflows it, Ollama shifts the
// KV cache mid-stream and CRASHES the gemma4 runner (learned by the local worker).
const NUM_CTX = Number(Deno.env.get("OLLAMA_NUM_CTX")) || 8192;
const NUM_PREDICT = Number(Deno.env.get("OLLAMA_NUM_PREDICT")) || 4096;
const MIN_TEXT_CHARS = 60; // below this many non-whitespace chars, treat a PDF as scanned → vision
const RASTER_MAX_SIDE = 1600; // downscale rasterized pages so the vision encoder isn't flooded
const RASTER_MAX_PAGES = 5;

/** The columns the CSV importer understands (PURCHASE_IMPORT_COLUMNS). The model is told
 *  to use exactly these keys per line so the client maps 1:1. */
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
      "ptr": number,         // price to retailer per unit (rupees, tax-exclusive), else 0
      "pts": number,         // price to stockist per unit (rupees, tax-exclusive), else 0 — fill BOTH if the bill prints both
      "amount": number,      // the line net/taxable VALUE as printed (after scheme/discount, before GST), else 0
      "mrp": number,         // printed MRP per unit (rupees), else 0
      "gst_rate": number,    // % (0/5/12/18), use the line's IGST or CGST+SGST sum
      "discount_pct": number // trade discount %, else 0
    }
  ]
}
Rules: numbers are plain (no currency symbols/commas). If a field is absent use ""
for strings and 0 for numbers. Do NOT invent lines; transcribe only what is printed.
When the bill prints both PTR and PTS, capture BOTH, plus the line value/amount column
as "amount" — the rate the line total was computed from is reconciled downstream.
Money is per-unit in rupees, not paise.`;

const RETRYABLE = new Set([429, 502, 503, 504]); // transient capacity — retry, then next model
const MAX_ATTEMPTS = 3;

/** Thrown when a model exhausts its retries on a transient error — fall to the next model. */
class TransientModelError extends Error {}

const decodeB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function encodeB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

interface ChatMessage {
  role: "user";
  content: string;
  images?: string[];
}

/** POST /api/chat with backoff retry on transient (429/5xx). Returns the raw Response on
 *  any non-retryable outcome (incl. 2xx); throws TransientModelError when it keeps 5xx-ing. */
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
  throw new TransientModelError(lastDetail.slice(0, 200)); // unreachable, satisfies the type
}

/** One pass over the model chain at a given `think` setting. */
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
      // A non-thinking model rejects the `think` param → signal the caller to drop it.
      if (think !== undefined && /think/i.test(detail)) return { rejectedThink: true };
      // 404 = this key can't use this model → try the next in the chain.
      if (r.status === 404 && MODELS.indexOf(model) < MODELS.length - 1) continue;
      throw new Error(`Ollama API ${r.status}: ${detail.slice(0, 300)}`);
    } catch (e) {
      if (e instanceof TransientModelError) {
        transient = e.message;
        continue; // capacity-shedding — try the next model
      }
      throw e;
    }
  }
  return { transient };
}

/** Send a chat and return the model's text content. `think:false` makes gemma4 emit JSON
 *  directly; if a non-thinking model rejects `think`, drop it and retry (worker learning). */
async function postChat(key: string, messages: ChatMessage[]): Promise<string> {
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

const looksLikePdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

/** Pull the embedded text layer of a digital PDF (unpdf → pdf.js, no canvas needed).
 *  Near-empty for scanned PDFs — the caller then falls back to rasterized vision. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("npm:unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n");
  } catch {
    return ""; // no text layer / lib hiccup → fall back to vision
  }
}

/** Rasterize a (scanned) PDF to base64 PNG page images, downscaled to RASTER_MAX_SIDE.
 *  mupdf is pure wasm (works in the Edge runtime, unlike poppler/sips on the local worker).
 *  Dynamic-imported + isolated so a failure here never affects the text/image/CSV paths. */
async function pdfToImages(bytes: Uint8Array): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mupdf wasm has no Deno-resolvable types here
  let mupdf: any;
  try {
    mupdf = await import("npm:mupdf");
  } catch (e) {
    throw new Error(`could not load the PDF rasterizer for this scanned PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const pages = Math.min(doc.countPages(), RASTER_MAX_PAGES);
  if (pages === 0) throw new Error("the PDF has no pages");
  const images: string[] = [];
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = RASTER_MAX_SIDE / Math.max(x1 - x0, y1 - y0, 1);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    images.push(encodeB64(pixmap.asPNG()));
  }
  return images;
}

/** Decide HOW to read the file, then run it through the model — returns the model's JSON text. */
async function extract(key: string, b64: string, mime: string): Promise<string> {
  // CSV / tabular text — normalise an arbitrary column layout into the schema.
  if (mime.startsWith("text/") || mime === "application/csv") {
    const text = new TextDecoder().decode(decodeB64(b64));
    return postChat(key, [{ role: "user", content: `${PROMPT}\n\nCSV / tabular export to map into the schema above:\n\n${text}` }]);
  }

  const bytes = decodeB64(b64);

  if (mime === "application/pdf" || looksLikePdf(bytes)) {
    // 1. Digital PDF — a text layer is exact + cheap (no vision/OCR error).
    const text = await pdfText(bytes);
    if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
      return postChat(key, [{ role: "user", content: `${PROMPT}\n\nInvoice text (extracted from the PDF) to map into the schema above:\n\n${text}` }]);
    }
    // 2. Scanned PDF — no usable text → rasterize → vision.
    const images = await pdfToImages(bytes);
    return postChat(key, [{ role: "user", content: PROMPT, images }]);
  }

  if (mime.startsWith("image/")) {
    return postChat(key, [{ role: "user", content: PROMPT, images: [b64] }]);
  }

  throw new Error(`unsupported_file: ${mime} — upload a PDF, an image (JPG/PNG), or a CSV`);
}

/** Pull the FIRST complete JSON object out of the model's reply, tolerating stray fencing
 *  AND trailing content (a model sometimes appends a second object or prose). Brace-match
 *  from the first { (respecting strings + escapes) and parse exactly that object. */
function parseModelJson(raw: string): unknown {
  const fence = raw.replace(/```json\s*|\s*```/g, "");
  const start = fence.indexOf("{");
  if (start === -1) throw new Error("model did not return JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < fence.length; i++) {
    const ch = fence[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(fence.slice(start, i + 1));
    }
  }
  throw new Error("model returned incomplete JSON"); // never closed → truncated output
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...CORS, "content-type": "application/json" } });
  }

  const key = Deno.env.get("OLLAMA_API_KEY") ?? Deno.env.get("OCR_API_KEY");
  if (!key) {
    // Distinct signal so the client shows "OCR not configured" rather than a generic error.
    return new Response(JSON.stringify({ error: "ocr_not_configured" }), { status: 501, headers: { ...CORS, "content-type": "application/json" } });
  }

  try {
    const { file_base64, mime } = await req.json();
    if (!file_base64 || !mime) {
      return new Response(JSON.stringify({ error: "file_base64 and mime required" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    }
    const text = await extract(key, file_base64, mime);
    const json = parseModelJson(text);
    return new Response(JSON.stringify(json), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "extraction failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
