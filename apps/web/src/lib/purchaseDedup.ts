import { supabase } from "./supabase";

/**
 * Duplicate-invoice guard for the purchase importers (OCR + CSV). A vendor invoice
 * should be captured once: re-importing the same bill would double the stock + ITC.
 * `findExistingInvoice` looks up a posted GRN (`purchases`) with the same vendor
 * invoice number for the org — case-insensitive, narrowed by vendor name when both
 * are known — so the importer can flag + skip it. Network helper (not pure); the
 * vendor-name match is the only fuzzy bit, kept lenient so minor name vari/
 * abbreviations still match.
 */
export interface ExistingInvoice {
  /** The posted GRN's id. */
  id: string;
  /** A human reference for the message (grn_no, else the invoice no, else short id). */
  ref: string;
}

/** Lenient vendor-name match: equal, or one contains the other (after lower-casing).
 *  Empty on either side ⇒ match (we only had the invoice number to go on). Exported
 *  for unit testing. */
export function vendorNameMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return true;
  return x === y || x.includes(y) || y.includes(x);
}

interface PurchaseDupRow {
  id: string;
  grn_no: string | null;
  vendor_invoice_no: string | null;
  vendor: { name: string } | { name: string }[] | null;
}

/** The existing posted GRN for this (invoiceNo, vendor) in the org, or null. */
export async function findExistingInvoice(
  orgId: string,
  invoiceNo: string,
  vendorName: string,
): Promise<ExistingInvoice | null> {
  if (!supabase || !invoiceNo.trim()) return null;
  // ilike with no wildcards = case-insensitive exact match on the invoice number.
  const { data } = await supabase
    .from("purchases")
    .select("id,grn_no,vendor_invoice_no,vendor:ledgers(name)")
    .eq("org_id", orgId)
    .ilike("vendor_invoice_no", invoiceNo.trim())
    .limit(10);
  for (const r of (data as PurchaseDupRow[] | null) ?? []) {
    const vn = Array.isArray(r.vendor) ? r.vendor[0]?.name ?? "" : r.vendor?.name ?? "";
    if (vendorNameMatches(vendorName, vn)) {
      return { id: r.id, ref: r.grn_no ?? r.vendor_invoice_no ?? `#${r.id.slice(0, 8)}` };
    }
  }
  return null;
}
