// Turn a downloaded invoice file into base64 page images for the vision model.
// Images pass straight through; PDFs are rasterized with poppler's `pdftoppm`
// (brew install poppler), downscaled to MAX_IMAGE_PX so a dense multi-page bill
// doesn't blow the model's context. One base64 string per page, page order.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config.ts";

export function fileToImages(bytes: Uint8Array, mime: string): string[] {
  if (mime.startsWith("image/")) {
    return [Buffer.from(bytes).toString("base64")];
  }
  if (mime === "application/pdf" || looksLikePdf(bytes)) {
    return rasterizePdf(bytes);
  }
  throw new Error(`unsupported file type for vision OCR: ${mime}`);
}

function looksLikePdf(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // "%PDF"
}

function rasterizePdf(bytes: Uint8Array): string[] {
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

function pageNum(filename: string): number {
  const m = filename.match(/(\d+)\.png$/);
  return m ? Number(m[1]) : 0;
}
