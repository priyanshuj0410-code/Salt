import type { PurchaseRawRow } from "./importPurchaseInvoice";

/**
 * OCR invoice mapping (SALT-027). The `extract-invoice` Edge Function returns an
 * invoice header + lines as JSON; this turns that into the SAME row shape the CSV
 * purchase-importer consumes (one PurchaseRawRow per line, canonical keys), so the
 * existing `parsePurchaseInvoices` → review → `receive_purchase` post path handles
 * it with no duplicate logic. Pure (no network, no Supabase) → unit-testable; the
 * function call itself lives in the page.
 */

/** Shape the Edge Function returns (mirrors its prompt). All fields optional/loose
 *  because it is model output — we coerce defensively. */
export interface OcrInvoiceJson {
  invoice_no?: unknown;
  date?: unknown;
  vendor?: unknown;
  vendor_gstin?: unknown;
  lines?: unknown;
}

const str = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim();
};

export interface OcrMapResult {
  rows: PurchaseRawRow[];
  /** Non-fatal notes for the UI (e.g. "no line items found"). */
  issues: string[];
}

/**
 * Map one extracted invoice into importer rows. Header fields (invoice_no, date,
 * vendor, vendor_gstin) are repeated on every line — exactly how the CSV importer
 * groups one-row-per-line files. Keys are the canonical PURCHASE_IMPORT_COLUMNS,
 * so no header-aliasing is needed downstream.
 */
export function ocrInvoiceToRows(json: OcrInvoiceJson): OcrMapResult {
  const issues: string[] = [];
  const header = {
    invoice_no: str(json.invoice_no),
    date: str(json.date),
    vendor: str(json.vendor),
    vendor_gstin: str(json.vendor_gstin),
  };
  if (!header.invoice_no) issues.push("No invoice number found — set one before posting.");
  if (!header.vendor) issues.push("No vendor name found — set one before posting.");

  const lines = Array.isArray(json.lines) ? (json.lines as Record<string, unknown>[]) : [];
  if (lines.length === 0) issues.push("No line items were extracted from this document.");

  const rows: PurchaseRawRow[] = lines.map((l) => ({
    ...header,
    item_name: str(l.item_name),
    item_code: str(l.item_code),
    hsn: str(l.hsn),
    batch_no: str(l.batch_no),
    expiry: str(l.expiry),
    qty: str(l.qty),
    free_qty: str(l.free_qty),
    ptr: str(l.ptr),
    mrp: str(l.mrp),
    gst_rate: str(l.gst_rate),
    discount_pct: str(l.discount_pct),
  }));

  return { rows, issues };
}
