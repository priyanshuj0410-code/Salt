import type { BillLine } from "./types";

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
