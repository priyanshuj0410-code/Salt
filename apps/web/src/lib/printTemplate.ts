/**
 * Shared contract for the sales-invoice print template. Authored in
 * Settings → Print templates (writes `print_templates`), and read by the print
 * path (`lib/printInvoice.ts`) once that consumer is wired. Defaults mirror the
 * current hardcoded layout so behaviour is unchanged until a template is saved.
 */

/** Maps to the `print_templates.format` check constraint. */
export type PrintFormat = "thermal" | "a4" | "dotmatrix";

export interface InvoiceTemplate {
  /** Thermal roll width in mm (only meaningful when format === "thermal"). */
  thermal_width: 58 | 80;
  /** Extra line printed under the shop name (e.g. "Retail Chemist & Druggist"). */
  header_tagline: string;
  /** Print the shop GSTIN in the header. */
  show_gstin: boolean;
  /** Print batch no. + expiry under each line item. */
  show_batch_expiry: boolean;
  /** Footer thank-you line. */
  footer_text: string;
  /** Terms / jurisdiction line (e.g. "Goods once sold are not returnable"). */
  terms_text: string;
  /** Copies to print (1–3). */
  copies: number;
}

export const DEFAULT_FORMAT: PrintFormat = "thermal";

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = {
  thermal_width: 80,
  header_tagline: "",
  show_gstin: true,
  show_batch_expiry: true,
  footer_text: "Thank you. Get well soon.",
  terms_text: "",
  copies: 1,
};

export const PRINT_FORMAT_LABELS: Record<PrintFormat, string> = {
  thermal: "Thermal roll",
  a4: "A4 sheet",
  dotmatrix: "Dot-matrix",
};

/** Coerce a stored jsonb blob into a complete template (tolerates missing/old keys). */
export function normalizeTemplate(raw: unknown): InvoiceTemplate {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_INVOICE_TEMPLATE;
  return {
    thermal_width: r.thermal_width === 58 ? 58 : 80,
    header_tagline: typeof r.header_tagline === "string" ? r.header_tagline : d.header_tagline,
    show_gstin: typeof r.show_gstin === "boolean" ? r.show_gstin : d.show_gstin,
    show_batch_expiry: typeof r.show_batch_expiry === "boolean" ? r.show_batch_expiry : d.show_batch_expiry,
    footer_text: typeof r.footer_text === "string" ? r.footer_text : d.footer_text,
    terms_text: typeof r.terms_text === "string" ? r.terms_text : d.terms_text,
    copies: typeof r.copies === "number" && r.copies >= 1 && r.copies <= 3 ? Math.round(r.copies) : d.copies,
  };
}

/** Normalize a stored format string, falling back to the default. */
export function normalizeFormat(raw: unknown): PrintFormat {
  return raw === "a4" || raw === "dotmatrix" || raw === "thermal" ? raw : DEFAULT_FORMAT;
}
