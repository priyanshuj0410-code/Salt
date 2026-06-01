/**
 * GST invoice numbering series (SALT-067). A shop can run several named series
 * (`code`: DEFAULT / RETAIL / WS / branch…) for its sales invoices, each with its
 * own prefix + zero-pad width; the running number resets per Indian financial
 * year. Backed by `invoice_series` (0024 + 0033) and allocated gap-free by the
 * `next_doc_no(shop, 'sales_invoice', code)` RPC — `create_sales_invoice` already
 * pulls from the shop's default active series.
 *
 * These helpers are pure (no Supabase / DOM) and unit-smoke-tested.
 */

/** Indian financial year (Apr–Mar) for a date → 'YYYY-YY', e.g. Jun 2026 → '2026-27'. */
export function currentIndianFy(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1; // month 3 = April (0-based)
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Preview the next document number for a series: `PREFIX/FY/00007`. */
export function seriesPreview(prefix: string, fy: string, width: number, next: number): string {
  return `${prefix || ""}/${fy}/${String(next).padStart(Math.max(1, width), "0")}`;
}

/** Normalise a user-typed series code: upper-case, alnum + dash, ≤ 12 chars. */
export function normalizeSeriesCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}
