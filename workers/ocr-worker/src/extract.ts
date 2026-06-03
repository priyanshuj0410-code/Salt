// Decide HOW to read an invoice and run it through the model, returning the OcrInvoiceJson.
// Routing (PRD §6):
//   • CSV / text export      → text path (callOllamaText)
//   • digital PDF (text layer) → text path  (pdftotext — no rasterize, no vision, exact)
//   • scanned PDF (no usable text) → rasterize → per-page vision → merge
//   • image                   → downscale → vision
// `onStage` reports live progress (the test harness streams it to the page / terminal).
// Shared by the worker (index.ts) and the test harness (test-server.ts).
import { mergeInvoiceJson, parseModelJson, PROMPT } from "./contract.ts";
import { callOllamaText, callOllamaVision, type ProgressFn } from "./ollama.ts";
import { imageToBase64, looksLikePdf, pdfText, pdfToImages } from "./files.ts";

export type ExtractMode = "csv-text" | "pdf-text" | "pdf-vision" | "image";
export type StageFn = (msg: string) => void;

export interface Extraction {
  json: unknown;
  mode: ExtractMode;
  images: string[]; // page images sent to the vision model (empty on text paths)
  text: string | null; // text sent to the model (text paths)
}

// Below this many non-whitespace chars, treat a PDF as scanned → fall back to vision.
const MIN_TEXT_CHARS = 60;

function textPrompt(label: string, text: string): string {
  return `${PROMPT}\n\n${label} to map into the schema above:\n\n${text}`;
}

function isCsv(mime: string, filename: string): boolean {
  return mime.startsWith("text/") || /csv$/i.test(mime) || /\.csv$/i.test(filename);
}

/** Turn an unusable model reply into a specific, actionable error — distinguishing
 *  "nothing", "prose not JSON", "stub object, couldn't extract", and "JSON cut off",
 *  with hints that match the actual lane (vision vs text), not a blanket guess. */
function explainBadOutput(raw: string, model: string | undefined, mode: ExtractMode): string {
  const who = model ?? "the model";
  const vision = mode === "image" || mode === "pdf-vision";
  const where = vision ? "image" : "document";
  const other = /gemma/i.test(model ?? "") ? "a different model, or the paid Flash lane" : "gemma4 (the strongest local model here)";
  const t = raw.trim();
  const shown = JSON.stringify(t.length > 200 ? `${t.slice(0, 200)}…` : t);

  if (t === "") {
    return `${who} returned nothing for this ${where}. ${vision ? `It may not read this image well — try ${other}.` : `Try ${other}.`}`;
  }
  if (!t.includes("{")) {
    return `${who} replied with prose, not JSON (${shown}). ${vision ? `Pick a model tagged ·vision, or try ${other}.` : `It ignored JSON mode — try ${other}.`}`;
  }
  if (/^\{\s*\}?$/.test(t)) {
    return `${who} couldn't extract anything from this ${where} (returned an empty object and stopped). Try ${other}; if every model returns nothing the file may be a blurry/blank/rotated scan, or a non-invoice page.`;
  }
  return `${who}'s JSON was cut off mid-output (${shown}). The invoice is likely larger than the context window — raise OLLAMA_NUM_CTX + OLLAMA_NUM_PREDICT in .env (ctx > predict), or try ${other}.`;
}

function parse(raw: string, model: string | undefined, mode: ExtractMode): unknown {
  try {
    return parseModelJson(raw);
  } catch {
    throw new Error(explainBadOutput(raw, model, mode));
  }
}

export async function extractInvoice(
  bytes: Uint8Array,
  mime: string,
  filename = "",
  model?: string,
  onStage?: StageFn,
): Promise<Extraction> {
  const say: StageFn = onStage ?? (() => {});
  const m = model ?? "the model";
  const prog: ProgressFn = ({ tokens }) => say(`${m}: ${tokens} tokens generated…`);

  if (isCsv(mime, filename)) {
    const text = new TextDecoder().decode(bytes);
    say(`Running ${m} on the CSV text…`);
    const raw = await callOllamaText(textPrompt("CSV / tabular export", text), model, prog);
    return { json: parse(raw, model, "csv-text"), mode: "csv-text", images: [], text };
  }

  if (mime === "application/pdf" || looksLikePdf(bytes)) {
    say("Reading the PDF text layer (pdftotext)…");
    const text = pdfText(bytes);
    const chars = text.replace(/\s/g, "").length;
    if (chars >= MIN_TEXT_CHARS) {
      say(`Found a text layer (${chars} chars) — running ${m} on it…`);
      const viaText = await tryText(text, model, prog);
      if (viaText) return { json: viaText, mode: "pdf-text", images: [], text };
      say("Text layer produced no line items — treating it as a scan, rasterizing instead…");
    } else {
      say(`Little/no text layer (${chars} chars) — it's a scan; rasterizing…`);
    }
    say("Rasterizing pages with poppler…");
    const images = pdfToImages(bytes);
    say(`Rendered ${images.length} page image(s); running ${m} (the first call loads the model, ~1 min)…`);
    return { json: await visionExtract(images, model, "pdf-vision", say, prog), mode: "pdf-vision", images, text: null };
  }

  say(`Preparing image (downscaling); running ${m} (the first call loads the model, ~1 min)…`);
  const images = [imageToBase64(bytes)];
  return { json: await visionExtract(images, model, "image", say, prog), mode: "image", images, text: null };
}

/** One vision call PER PAGE (an oversized multi-image batch crashes ggml), merged into a
 *  single invoice — header from the first page that has one, line items concatenated. */
async function visionExtract(
  images: string[],
  model: string | undefined,
  mode: ExtractMode,
  say: StageFn,
  prog: ProgressFn,
): Promise<unknown> {
  if (images.length <= 1) return parse(await callOllamaVision(images, PROMPT, model, prog), model, mode);
  const parts: unknown[] = [];
  for (let i = 0; i < images.length; i++) {
    say(`Reading page ${i + 1}/${images.length}…`);
    parts.push(parse(await callOllamaVision([images[i]], PROMPT, model, prog), model, mode));
  }
  return mergeInvoiceJson(parts);
}

/** Run the PDF text-layer path, but return null (not throw) when it yields no usable lines —
 *  so extractInvoice can fall back to vision instead of failing (a scanned PDF whose text
 *  layer is page numbers / a watermark / OCR junk passes the char threshold but extracts
 *  nothing). */
async function tryText(text: string, model: string | undefined, prog: ProgressFn): Promise<unknown | null> {
  let json: unknown;
  try {
    json = parseModelJson(await callOllamaText(textPrompt("Invoice text extracted from the PDF", text), model, prog));
  } catch {
    return null;
  }
  return hasLines(json) ? json : null;
}

function hasLines(json: unknown): boolean {
  return (
    !!json &&
    typeof json === "object" &&
    Array.isArray((json as { lines?: unknown }).lines) &&
    (json as { lines: unknown[] }).lines.length > 0
  );
}
