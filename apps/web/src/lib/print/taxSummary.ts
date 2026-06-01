import { splitInclusiveGst } from "../currency";
import { gstSplit } from "../billing";
import type { InvoiceLine } from "./types";

/** One row of the rate-wise tax breakup printed on a CGST-compliant tax invoice. */
export interface TaxRateRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * Group invoice lines by GST rate and back out the taxable value + tax per rate
 * (rule 46 wants tax shown rate-wise). MRP is GST-inclusive, so each line's
 * taxable/GST is recovered with `splitInclusiveGst`, then summed per rate and
 * split into CGST+SGST (intra-state) or IGST (inter-state).
 */
export function taxSummary(lines: InvoiceLine[], isInterstate: boolean): TaxRateRow[] {
  const byRate = new Map<number, { taxable: number; gst: number }>();
  for (const l of lines) {
    const { taxable, gst } = splitInclusiveGst(l.netPaise, l.gstRate);
    const cur = byRate.get(l.gstRate) ?? { taxable: 0, gst: 0 };
    cur.taxable += taxable;
    cur.gst += gst;
    byRate.set(l.gstRate, cur);
  }
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, taxable: v.taxable, ...gstSplit(v.gst, isInterstate) }));
}
