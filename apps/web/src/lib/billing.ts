import type { BillLine, DiscountType, Schedule } from "./types";

/**
 * Schedules that hard-gate checkout: a sale containing one of these may not be
 * saved until the prescriber + patient are recorded (Drugs & Cosmetics Rules —
 * the Schedule H1 register; X is narcotic/psychotropic, stricter still). Plain
 * Schedule H needs a prescription but no separate register, so it is not gated.
 * Mirrors the server contract in `record_h1_entry` / `enforce_h1_gate`.
 */
export const GATED_SCHEDULES: Schedule[] = ["H1", "X"];

export function isGatedSchedule(s: Schedule): boolean {
  return s === "H1" || s === "X";
}

/** True when the bill has any Schedule H1/X line and so needs prescription capture. */
export function requiresRx(lines: BillLine[]): boolean {
  return lines.some((l) => isGatedSchedule(l.schedule));
}

/** The H1/X lines on the bill — shown in the gate so the cashier sees what triggered it. */
export function gatedLines(lines: BillLine[]): BillLine[] {
  return lines.filter((l) => isGatedSchedule(l.schedule));
}

export function lineGross(l: BillLine): number {
  return l.mrpPaise * l.qty;
}

/** Discount amount in paise: percentage of gross, or a flat paise amount capped at gross. */
export function lineDiscount(l: BillLine): number {
  const gross = lineGross(l);
  if (l.discountType === "pct") {
    const pct = Math.max(0, Math.min(100, l.discountValue));
    return Math.round((gross * pct) / 100);
  }
  return Math.max(0, Math.min(l.discountValue, gross));
}

/** What the customer pays for the line, after discount. */
export function lineNet(l: BillLine): number {
  return lineGross(l) - lineDiscount(l);
}

/** Landed cost of the line (PTR x qty). */
export function lineCost(l: BillLine): number {
  return l.ptrPaise * l.qty;
}

/** Estimated earning for the line: net selling minus landed cost. */
export function lineMargin(l: BillLine): number {
  return lineNet(l) - lineCost(l);
}

/** Total quantity of an item already on the bill, optionally excluding some line keys. */
export function sumItemQty(lines: BillLine[], itemId: string, excludeKeys: string[] = []): number {
  return lines
    .filter((l) => l.itemId === itemId && !excludeKeys.includes(l.key))
    .reduce((sum, l) => sum + l.qty, 0);
}

/**
 * Max quantity this line can hold: the item's total stock (line.stock) minus
 * what other lines of the same item already use. Caps per item, not per batch.
 */
export function lineMaxQty(lines: BillLine[], line: BillLine): number {
  return line.stock - sumItemQty(lines, line.itemId, [line.key]);
}

/** A discount applied to the whole bill, on top of any per-line discounts. */
export interface BillDiscount {
  /** "pct" = percent of the post-line-discount bill; "flat" = paise off the bill. */
  type: DiscountType;
  value: number;
}

export const NO_BILL_DISCOUNT: BillDiscount = { type: "pct", value: 0 };

/** The bill-level discount in paise, capped at the summed post-line-discount net. */
export function billDiscountPaise(lines: BillLine[], bill: BillDiscount): number {
  const total = lines.reduce((sum, l) => sum + lineNet(l), 0);
  if (total <= 0) return 0;
  if (bill.type === "pct") {
    const pct = Math.max(0, Math.min(100, bill.value));
    return Math.round((total * pct) / 100);
  }
  return Math.max(0, Math.min(Math.round(bill.value), total));
}

/**
 * Each line's net after distributing the bill-level discount **pro-rata by line
 * net**, using the largest-remainder method so the per-line shares sum to the
 * discount **exactly**. The same apportionment feeds the totals, the
 * `create_sales_invoice` payload and the printed receipt, so the client and
 * server GST splits always agree. Returns the plain line nets when there is no
 * bill discount.
 */
export function apportionedLineNets(lines: BillLine[], bill: BillDiscount): number[] {
  const nets = lines.map(lineNet);
  const total = nets.reduce((a, b) => a + b, 0);
  const cut = billDiscountPaise(lines, bill);
  if (cut <= 0 || total <= 0) return nets;
  const shares = nets.map((n) => Math.floor((cut * n) / total));
  const frac = (i: number) => (cut * nets[i]) / total - Math.floor((cut * nets[i]) / total);
  let remainder = cut - shares.reduce((a, b) => a + b, 0);
  // Hand each leftover paise to the largest fractional part (then the larger net).
  const order = nets.map((_, i) => i).sort((a, b) => frac(b) - frac(a) || nets[b] - nets[a]);
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) shares[order[k]] += 1;
  return nets.map((n, i) => n - shares[i]);
}

/**
 * Split a total GST amount into the CGST/SGST (intra-state) or IGST (inter-state)
 * components shown at checkout and on the invoice. Inter-state ⇒ the whole tax is
 * IGST; intra-state ⇒ half CGST + half SGST (the remainder goes to SGST so the two
 * always sum back to `gstPaise`). Mirrors the server split in create_sales_invoice.
 */
export function gstSplit(gstPaise: number, isInterstate: boolean): { cgst: number; sgst: number; igst: number } {
  if (isInterstate) return { cgst: 0, sgst: 0, igst: gstPaise };
  const cgst = Math.round(gstPaise / 2);
  return { cgst, sgst: gstPaise - cgst, igst: 0 };
}
