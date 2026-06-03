import { supabase } from "./supabase";

/**
 * Duplicate-invoice guard for the unified import queue (OCR + CSV). A vendor invoice
 * should be captured once: re-importing the same bill would double the stock + ITC.
 * `findExistingInvoice` matches the same vendor invoice number for the org against
 * **both** a posted GRN (`purchases`) **and** an in-flight scan (`invoice_scans`) —
 * case-insensitive, narrowed by vendor name when both are known. Checking the queue
 * (not just posted GRNs) is what catches cross-channel + pre-post duplicates, e.g. the
 * same bill uploaded once by OCR and once by CSV before either is posted. Network
 * helper (not pure); the vendor-name match is the only fuzzy bit, kept lenient so
 * minor name variations / abbreviations still match.
 */
export interface ExistingInvoice {
  /** The matched GRN id (kind 'grn') or scan id (kind 'scan'). */
  id: string;
  /** A human reference for the message (grn_no/invoice no, else vendor/file, else short id). */
  ref: string;
  /** Where the match was found: a posted GRN, or an in-flight queued scan. */
  kind: "grn" | "scan";
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

interface ScanDupRow {
  id: string;
  vendor_guess: string | null;
  original_filename: string | null;
}

/**
 * The existing GRN or in-flight scan for this (invoiceNo, vendor) in the org, or null.
 * `opts.excludeIds` are scan ids to ignore — the rows belonging to the current upload —
 * so a fresh import is never flagged as a duplicate of itself.
 */
export async function findExistingInvoice(
  orgId: string,
  invoiceNo: string,
  vendorName: string,
  opts?: { excludeIds?: string[] },
): Promise<ExistingInvoice | null> {
  const inv = invoiceNo.trim();
  if (!supabase || !inv) return null;

  // 1. A posted GRN with this invoice number wins — it's the strongest signal.
  // ilike with no wildcards = case-insensitive exact match on the invoice number.
  const { data: grns } = await supabase
    .from("purchases")
    .select("id,grn_no,vendor_invoice_no,vendor:ledgers(name)")
    .eq("org_id", orgId)
    .ilike("vendor_invoice_no", inv)
    .limit(10);
  for (const r of (grns as PurchaseDupRow[] | null) ?? []) {
    const vn = Array.isArray(r.vendor) ? r.vendor[0]?.name ?? "" : r.vendor?.name ?? "";
    if (vendorNameMatches(vendorName, vn)) {
      return { id: r.id, ref: r.grn_no ?? r.vendor_invoice_no ?? `#${r.id.slice(0, 8)}`, kind: "grn" };
    }
  }

  // 2. An in-flight scan (uploaded on either channel, not yet a GRN) with the same
  //    invoice number — catches cross-channel + pre-post dupes. Skip the current
  //    upload's own rows (excludeIds) so it never matches itself.
  //    Match on the invoice number INSIDE the stored extraction
  //    (`extracted_json->>invoice_no`), not the denormalised `invoice_no` column: that
  //    column is only written by the newer process-scans worker, so relying on it
  //    silently breaks this check whenever an older worker is deployed. The extraction
  //    JSON is always present once a scan has extracted.
  const exclude = new Set(opts?.excludeIds ?? []);
  const { data: scans } = await supabase
    .from("invoice_scans")
    .select("id,vendor_guess,original_filename")
    .eq("org_id", orgId)
    .ilike("extracted_json->>invoice_no", inv)
    .in("status", ["pending", "processing", "extracted", "duplicate"])
    .limit(10);
  for (const r of (scans as ScanDupRow[] | null) ?? []) {
    if (exclude.has(r.id)) continue;
    if (vendorNameMatches(vendorName, r.vendor_guess ?? "")) {
      return {
        id: r.id,
        ref: r.vendor_guess ?? r.original_filename ?? inv,
        kind: "scan",
      };
    }
  }
  return null;
}
