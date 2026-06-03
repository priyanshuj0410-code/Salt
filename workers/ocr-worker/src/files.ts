// File → model-input helpers. Local models (Ollama/Gemma) cannot read PDFs — only
// raster images — so a scanned PDF must be rasterized (poppler `pdftoppm`). A *digital*
// PDF instead has a text layer we can pull with `pdftotext` and feed as text (no vision,
// no OCR error). Phone photos / scans are downscaled (macOS `sips`) so the vision encoder
// is not flooded — an oversized image crashes ggml. The orchestration (which path) is in
// extract.ts. `brew install poppler` provides pdftoppm + pdftotext; sips ships with macOS.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.ts";

export function looksLikePdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"
}

/** Pull the embedded text layer of a digital PDF (poppler pdftotext, -layout keeps the
 *  column structure). Near-empty for scanned PDFs — the caller then falls back to vision. */
export function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "salt-ocr-"));
  try {
    const pdf = join(dir, "in.pdf");
    writeFileSync(pdf, bytes);
    const r = spawnSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return r.status === 0 ? (r.stdout ?? "") : "";
  } catch {
    return "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Rasterize a (scanned) PDF to base64 PNG page images, downscaled to MAX_IMAGE_PX. */
export function pdfToImages(bytes: Uint8Array): string[] {
  const dir = mkdtempSync(join(tmpdir(), "salt-ocr-"));
  try {
    const pdf = join(dir, "in.pdf");
    writeFileSync(pdf, bytes);
    const r = spawnSync(
      "pdftoppm",
      ["-png", "-scale-to", String(config.maxImagePx), pdf, join(dir, "page")],
      { encoding: "buffer" },
    );
    if (r.error || r.status !== 0) {
      const detail = r.error?.message ?? r.stderr?.toString() ?? `exit ${r.status}`;
      throw new Error(`pdftoppm failed (is poppler installed? \`brew install poppler\`): ${detail.slice(0, 200)}`);
    }
    const pages = readdirSync(dir)
      .filter((f) => f.endsWith(".png"))
      .sort((a, b) => pageNum(a) - pageNum(b)); // page-2 before page-10
    if (pages.length === 0) throw new Error("pdftoppm produced no pages");
    return pages.map((f) => readFileSync(join(dir, f)).toString("base64"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A single image → base64 PNG, downscaled so the longest side ≤ MAX_IMAGE_PX (macOS
 *  `sips`, which also transcodes HEIC etc. to PNG). Falls back to the original bytes if
 *  sips is unavailable (e.g. a future Linux worker host) or fails. */
export function imageToBase64(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), "salt-ocr-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.png");
    writeFileSync(src, bytes);
    const r = spawnSync("sips", ["-s", "format", "png", "-Z", String(config.maxImagePx), src, "--out", out], { encoding: "buffer" });
    if (r.status === 0) {
      try {
        return readFileSync(out).toString("base64");
      } catch {
        // fall through to original
      }
    }
    return Buffer.from(bytes).toString("base64"); // sips missing/failed → send original
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pageNum(filename: string): number {
  const m = filename.match(/(\d+)\.png$/);
  return m ? Number(m[1]) : 0;
}
