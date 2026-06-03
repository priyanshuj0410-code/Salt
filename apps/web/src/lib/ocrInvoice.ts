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

/**
 * Pharma invoices print expiry as MM/YYYY (e.g. "08/2027") or a full date (Indian bills
 * use DD-MM-YYYY, e.g. "31-07-2027"), but the purchase importer validates `YYYY-MM`.
 * Normalise the common printed forms to `YYYY-MM` here (the OCR→rows boundary) so valid
 * dates aren't flagged — a pharma expiry is month-level, so the day is dropped. Two-digit
 * years map to 2000+YY. Anything we can't confidently parse (incl. an out-of-range month)
 * passes through unchanged, so the importer still warns on true garbage.
 */
export function normalizeExpiry(raw: string): string {
  const v = raw.trim();
  if (v === "" || /^\d{4}-\d{2}$/.test(v)) return v; // empty or already YYYY-MM

  // Full dates → keep month + year, drop the day. Indian invoices print DD-MM-YYYY;
  // the middle field is the month (an out-of-range month falls through to a warning).
  let m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/); // DD-MM-YYYY / DD-MM-YY
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}`;
  }
  m = v.match(/^(\d{4})[/-](\d{1,2})[/-]\d{1,2}$/); // ISO YYYY-MM-DD
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;

  const sep = v.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/); // MM/YYYY, MM-YY, M/YYYY
  if (sep) {
    const mm = sep[1].padStart(2, "0");
    const yyyy = sep[2].length === 2 ? `20${sep[2]}` : sep[2];
    if (Number(mm) >= 1 && Number(mm) <= 12) return `${yyyy}-${mm}`;
  }
  const ym = v.match(/^(\d{4})[/-](\d{1,2})$/); // YYYY/MM or YYYY/M
  if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
  return v; // unrecognised → leave as-is; importer flags it
}

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
    expiry: normalizeExpiry(str(l.expiry)),
    qty: str(l.qty),
    free_qty: str(l.free_qty),
    ptr: str(l.ptr),
    pts: str(l.pts),
    amount: str(l.amount),
    mrp: str(l.mrp),
    gst_rate: str(l.gst_rate),
    discount_pct: str(l.discount_pct),
  }));

  return { rows, issues };
}

export interface KeyedOcrInvoice {
  /** Group key: invoice_no + vendor (lower-cased) — matches parsePurchaseInvoices. */
  key: string;
  json: OcrInvoiceJson;
}

/**
 * Inverse of `ocrInvoiceToRows`: group canonical purchase rows back into one
 * `OcrInvoiceJson` per invoice (keyed by invoice_no + vendor — the same grouping
 * `parsePurchaseInvoices` uses). This lets a CSV import store each invoice in the
 * SAME `extracted_json` shape every queue row uses, so all channels share one review/
 * post path. Lossless: the raw `ptr`/`pts`/`amount` strings are preserved verbatim, so
 * the PTR/PTS reconciliation still re-derives the same way. Pure → unit-testable.
 */
export function rowsToOcrInvoices(rows: PurchaseRawRow[]): KeyedOcrInvoice[] {
  const order: string[] = [];
  const byKey = new Map<string, { json: OcrInvoiceJson; lines: Record<string, string>[] }>();
  for (const raw of rows) {
    const invoiceNo = str(raw.invoice_no);
    const vendor = str(raw.vendor);
    if (!invoiceNo || !vendor) continue; // mirrors parsePurchaseInvoices' skip rules
    const key = `${invoiceNo.toLowerCase()}|${vendor.toLowerCase()}`;
    let inv = byKey.get(key);
    if (!inv) {
      const lines: Record<string, string>[] = [];
      inv = {
        json: { invoice_no: invoiceNo, date: str(raw.date), vendor, vendor_gstin: str(raw.vendor_gstin), lines },
        lines,
      };
      byKey.set(key, inv);
      order.push(key);
    }
    inv.lines.push({
      item_name: str(raw.item_name),
      item_code: str(raw.item_code),
      hsn: str(raw.hsn),
      batch_no: str(raw.batch_no),
      expiry: str(raw.expiry),
      qty: str(raw.qty),
      free_qty: str(raw.free_qty),
      ptr: str(raw.ptr),
      pts: str(raw.pts),
      amount: str(raw.amount),
      mrp: str(raw.mrp),
      gst_rate: str(raw.gst_rate),
      discount_pct: str(raw.discount_pct),
    });
  }
  return order.map((key) => ({ key, json: byKey.get(key)!.json }));
}
