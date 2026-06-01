import type { PrintFormat, PrintLayout } from "./types";

/** All supported formats, in toolbar order. */
export const PRINT_FORMATS: readonly PrintFormat[] = ["thermal58", "thermal80", "a4", "dotmatrix"];

/** Short label shown on the print window's format switcher. */
export const FORMAT_LABEL: Record<PrintFormat, string> = {
  thermal58: "58 mm",
  thermal80: "80 mm",
  a4: "A4",
  dotmatrix: "Dot-matrix",
};

/**
 * The `@page` rule (paper size + margins) for each format. The print window swaps
 * this live when the format changes so the browser targets the right paper —
 * thermal rolls are fixed-width / auto-height, A4 is a bounded sheet, and the
 * dot-matrix form is a wide continuous page.
 */
export const PAGE_RULE: Record<PrintFormat, string> = {
  thermal58: "@page{size:58mm auto;margin:3mm 2mm}",
  thermal80: "@page{size:80mm auto;margin:4mm 3mm}",
  a4: "@page{size:A4;margin:12mm 12mm}",
  dotmatrix: "@page{size:216mm auto;margin:6mm 8mm}",
};

/** Which layout family draws a given format. 58/80 share the receipt layout. */
export const FORMAT_LAYOUT: Record<PrintFormat, PrintLayout> = {
  thermal58: "receipt",
  thermal80: "receipt",
  a4: "sheet",
  dotmatrix: "mono",
};

/** Body width (CSS) per format — receipts are roll-width, A4/dot-matrix fill the page. */
export const FORMAT_WIDTH: Record<PrintFormat, string> = {
  thermal58: "58mm",
  thermal80: "80mm",
  a4: "186mm",
  dotmatrix: "200mm",
};

/** The format used until the operator picks one (a common 80mm thermal roll). */
export const DEFAULT_FORMAT: PrintFormat = "thermal80";

export function isPrintFormat(v: unknown): v is PrintFormat {
  return typeof v === "string" && (PRINT_FORMATS as readonly string[]).includes(v);
}
