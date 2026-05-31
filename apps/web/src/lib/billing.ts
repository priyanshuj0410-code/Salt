import type { BillLine, Schedule } from "./types";

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
