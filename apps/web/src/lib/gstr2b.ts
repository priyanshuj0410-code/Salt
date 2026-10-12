// GSTR-2B import + ITC reconciliation (Smart Import, SALT-007). GSTR-2B is the
// GST portal's auto-drafted inward-ITC statement — NOT a Marg export. We import
// its B2B invoice rows into gstr2b_imports/gstr2b_lines, then reconcile them
// against the purchase register (by supplier GSTIN + invoice no) to flag ITC
// gaps: matched, mismatch (ITC differs), missing in books, or missing in 2B.

import { toPaise, toIsoDate, type FieldDef } from "@/lib/smartImport";

/** Columns of the portal's B2B sheet (period is a step input, not a column). */
export const GSTR2B_FIELDS: FieldDef[] = [
  { key: "vendor_gstin", label: "Supplier GSTIN", required: true, aliases: ["gstin", "gstin of supplier", "supplier gstin", "gstin/uin", "gstin of supplier of inward supply"] },
  { key: "invoice_no", label: "Invoice no", required: true, aliases: ["invoice number", "invoice no", "inv no", "document number", "bill no"] },
  { key: "invoice_date", label: "Invoice date", aliases: ["invoice date", "inv date", "document date", "date"] },
  { key: "taxable", label: "Taxable value", aliases: ["taxable value", "taxable", "taxable amount", "taxable value (rs)"] },
  { key: "igst", label: "IGST", aliases: ["integrated tax", "igst", "igst amount", "integrated tax (rs)"] },
  { key: "cgst", label: "CGST", aliases: ["central tax", "cgst", "cgst amount", "central tax (rs)"] },
  { key: "sgst", label: "SGST", aliases: ["state/ut tax", "sgst", "sgst amount", "state tax", "state/ut tax (rs)"] },
];

export const normGstin = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s/g, "");
export const normInv = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export interface Gstr2bLine {
  vendor_gstin: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

/** Build gstr2b_lines payloads from the mapped sheet. Blank rows are dropped. */
export function prepareLines(rows: Record<string, string>[], mapping: Record<string, string | null>): Gstr2bLine[] {
  const get = (row: Record<string, string>, key: string) => {
    const h = mapping[key];
    return h ? (row[h] ?? "").trim() : "";
  };
  const out: Gstr2bLine[] = [];
  for (const row of rows) {
    const gstin = normGstin(get(row, "vendor_gstin"));
    const inv = get(row, "invoice_no");
    if (!gstin && !inv) continue; // blank line
    out.push({
      vendor_gstin: gstin || null,
      invoice_no: inv || null,
      invoice_date: toIsoDate(get(row, "invoice_date")),
      taxable_paise: toPaise(get(row, "taxable")),
      cgst_paise: toPaise(get(row, "cgst")),
      sgst_paise: toPaise(get(row, "sgst")),
      igst_paise: toPaise(get(row, "igst")),
    });
  }
  return out;
}

export interface PurchaseForMatch {
  id: string;
  vendor_gstin: string | null;
  vendor_invoice_no: string | null;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

export type MatchStatus = "matched" | "mismatch" | "missing_in_books";

export interface LineMatch {
  lineIndex: number; // index into the lines array
  purchase_id: string | null;
  match_status: MatchStatus;
  variance_paise: number; // 2B ITC − books ITC
}

export interface ReconSummary {
  matched: number;
  mismatch: number;
  missingInBooks: number; // in 2B, no matching purchase
  missingIn2b: number; // purchase with no 2B line (count only, gstr2b_matches needs a line)
  itc2bPaise: number; // total ITC in the 2B file
  itcMatchedPaise: number; // 2B ITC that reconciles exactly to a purchase
}

export interface ReconResult {
  matches: LineMatch[];
  summary: ReconSummary;
}

const itc = (x: { cgst_paise: number; sgst_paise: number; igst_paise: number }) =>
  x.cgst_paise + x.sgst_paise + x.igst_paise;

/**
 * Reconcile 2B lines against the purchase register, keyed on (supplier GSTIN +
 * normalized invoice no). Each line → matched / mismatch / missing_in_books;
 * purchases not hit by any line are counted as missing_in_2b (not persisted —
 * gstr2b_matches requires a line FK).
 */
export function reconcile(lines: Gstr2bLine[], purchases: PurchaseForMatch[]): ReconResult {
  const byKey = new Map<string, PurchaseForMatch>();
  for (const p of purchases) {
    if (!p.vendor_gstin || !p.vendor_invoice_no) continue;
    byKey.set(`${normGstin(p.vendor_gstin)}|${normInv(p.vendor_invoice_no)}`, p);
  }
  const usedPurchaseIds = new Set<string>();
  const matches: LineMatch[] = [];
  let matched = 0;
  let mismatch = 0;
  let missingInBooks = 0;
  let itc2bPaise = 0;
  let itcMatchedPaise = 0;

  lines.forEach((l, i) => {
    const lineItc = itc(l);
    itc2bPaise += lineItc;
    const key = l.vendor_gstin && l.invoice_no ? `${normGstin(l.vendor_gstin)}|${normInv(l.invoice_no)}` : "";
    const p = key ? byKey.get(key) : undefined;
    if (!p) {
      missingInBooks++;
      matches.push({ lineIndex: i, purchase_id: null, match_status: "missing_in_books", variance_paise: lineItc });
      return;
    }
    usedPurchaseIds.add(p.id);
    const variance = lineItc - itc(p);
    if (variance === 0) {
      matched++;
      itcMatchedPaise += lineItc;
      matches.push({ lineIndex: i, purchase_id: p.id, match_status: "matched", variance_paise: 0 });
    } else {
      mismatch++;
      matches.push({ lineIndex: i, purchase_id: p.id, match_status: "mismatch", variance_paise: variance });
    }
  });

  const missingIn2b = purchases.filter(
    (p) => p.vendor_gstin && p.vendor_invoice_no && !usedPurchaseIds.has(p.id),
  ).length;

  return { matches, summary: { matched, mismatch, missingInBooks, missingIn2b, itc2bPaise, itcMatchedPaise } };
}
