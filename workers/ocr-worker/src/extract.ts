// Decide HOW to read an invoice and run it through the model, returning the OcrInvoiceJson.
// Routing (PRD §6):
//   • CSV / text export      → text path (callOllamaText)
//   • digital PDF (text layer) → text path  (pdftotext — no rasterize, no vision, exact)
//   • scanned PDF (no text)   → rasterize → per-page vision → merge
//   • image                   → downscale → vision
// Shared by the worker (index.ts) and the test harness (test-server.ts).
import { mergeInvoiceJson, parseModelJson, PROMPT } from "./contract.ts";
import { callOllamaText, callOllamaVision } from "./ollama.ts";
import { imageToBase64, looksLikePdf, pdfText, pdfToImages } from "./files.ts";

export type ExtractMode = "csv-text" | "pdf-text" | "pdf-vision" | "image";

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
  const t = raw.trim();
  const shown = JSON.stringify(t.length > 200 ? `${t.slice(0, 200)}…` : t);

  if (t === "") {
    return `${who} returned nothing for this ${where}.${vision ? " It likely can't read the image — switch to a model tagged ·vision (e.g. gemma4)." : " Try another model."}`;
  }
  if (!t.includes("{")) {
    return `${who} replied with prose, not JSON (${shown}).${vision ? " If it isn't a ·vision model it can't see the image — pick a ·vision one (gemma4 / qwen2.5vl)." : " It ignored JSON mode — try a different model."}`;
  }
  if (/^\{\s*\}?$/.test(t)) {
    return `${who} produced an empty object (${shown}) and stopped — it couldn't extract anything from this ${where}. Try gemma4, or confirm the file is a clear, readable invoice (a blurry, blank or rotated scan yields nothing).`;
  }
  return `${who}'s JSON was cut off mid-output (${shown}). The invoice is probably bigger than the context window — raise OLLAMA_NUM_CTX and OLLAMA_NUM_PREDICT in .env (keep ctx > predict), or try another model.`;
}

function parse(raw: string, model: string | undefined, mode: ExtractMode): unknown {
  try {
    return parseModelJson(raw);
  } catch {
    throw new Error(explainBadOutput(raw, model, mode));
  }
}

export async function extractInvoice(bytes: Uint8Array, mime: string, filename = "", model?: string): Promise<Extraction> {
  if (isCsv(mime, filename)) {
    const text = new TextDecoder().decode(bytes);
    const raw = await callOllamaText(textPrompt("CSV / tabular export", text), model);
    return { json: parse(raw, model, "csv-text"), mode: "csv-text", images: [], text };
  }

  if (mime === "application/pdf" || looksLikePdf(bytes)) {
    const text = pdfText(bytes);
    if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
      const raw = await callOllamaText(textPrompt("Invoice text extracted from the PDF", text), model);
      return { json: parse(raw, model, "pdf-text"), mode: "pdf-text", images: [], text };
    }
    const images = pdfToImages(bytes); // scanned PDF → vision
    return { json: await visionExtract(images, model, "pdf-vision"), mode: "pdf-vision", images, text: null };
  }

  const images = [imageToBase64(bytes)];
  return { json: await visionExtract(images, model, "image"), mode: "image", images, text: null };
}

/** One vision call PER PAGE (an oversized multi-image batch crashes ggml), merged into a
 *  single invoice — header from the first page that has one, line items concatenated. */
async function visionExtract(images: string[], model: string | undefined, mode: ExtractMode): Promise<unknown> {
  if (images.length <= 1) return parse(await callOllamaVision(images, PROMPT, model), model, mode);
  const parts: unknown[] = [];
  for (const img of images) parts.push(parse(await callOllamaVision([img], PROMPT, model), model, mode));
  return mergeInvoiceJson(parts);
}
