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

export async function extractInvoice(bytes: Uint8Array, mime: string, filename = ""): Promise<Extraction> {
  if (isCsv(mime, filename)) {
    const text = new TextDecoder().decode(bytes);
    const raw = await callOllamaText(textPrompt("CSV / tabular export", text));
    return { json: parseModelJson(raw), mode: "csv-text", images: [], text };
  }

  if (mime === "application/pdf" || looksLikePdf(bytes)) {
    const text = pdfText(bytes);
    if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS) {
      const raw = await callOllamaText(textPrompt("Invoice text extracted from the PDF", text));
      return { json: parseModelJson(raw), mode: "pdf-text", images: [], text };
    }
    const images = pdfToImages(bytes); // scanned PDF → vision
    return { json: await visionExtract(images), mode: "pdf-vision", images, text: null };
  }

  const images = [imageToBase64(bytes)];
  return { json: await visionExtract(images), mode: "image", images, text: null };
}

/** One vision call PER PAGE (an oversized multi-image batch crashes ggml), merged into a
 *  single invoice — header from the first page that has one, line items concatenated. */
async function visionExtract(images: string[]): Promise<unknown> {
  if (images.length <= 1) return parseModelJson(await callOllamaVision(images, PROMPT));
  const parts: unknown[] = [];
  for (const img of images) parts.push(parseModelJson(await callOllamaVision([img], PROMPT)));
  return mergeInvoiceJson(parts);
}
