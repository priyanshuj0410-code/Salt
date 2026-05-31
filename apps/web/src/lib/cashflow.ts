import { ageInDays } from "./aging";

/**
 * Vendor payment cash-flow — the forward-looking mirror of aging. Where aging
 * asks "how overdue is what they owe us", this asks "when do we owe vendors",
 * bucketed by days until the due date so the owner can plan outflows.
 *
 * Source: dated `cr` open bills (`ledger_bills`) on vendor parties. Post-cutover
 * credit purchases carry no payment-due date in the schema, so they are not
 * scheduled here.
 */

export interface UpcomingBuckets {
  overdue: number; // due date already passed
  d0_7: number; // due within a week
  d8_14: number;
  d15_30: number;
  later: number; // due more than 30 days out
  total: number;
}

export const EMPTY_UPCOMING: UpcomingBuckets = {
  overdue: 0,
  d0_7: 0,
  d8_14: 0,
  d15_30: 0,
  later: 0,
  total: 0,
};

export const UPCOMING_BANDS: { key: Exclude<keyof UpcomingBuckets, "total">; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "d0_7", label: "≤ 7 days" },
  { key: "d8_14", label: "8–14 days" },
  { key: "d15_30", label: "15–30 days" },
  { key: "later", label: "30+ days" },
];

/** Which band a due date falls in, relative to `now`. */
export function upcomingBand(dueDate: string | null, now: Date = new Date()): Exclude<keyof UpcomingBuckets, "total"> {
  const age = ageInDays(dueDate, null, now); // today − due
  if (age > 0) return "overdue"; // due date has passed
  const daysUntil = -age; // due − today
  if (daysUntil <= 7) return "d0_7";
  if (daysUntil <= 14) return "d8_14";
  if (daysUntil <= 30) return "d15_30";
  return "later";
}

/** One scheduled payable: a magnitude (≥ 0) and its due date. */
export interface PayableItem {
  amountPaise: number;
  dueDate: string | null;
}

/** Sum dated payables into upcoming bands (undated or non-positive skipped). */
export function upcomingPayments(items: PayableItem[], now: Date = new Date()): UpcomingBuckets {
  const out: UpcomingBuckets = { ...EMPTY_UPCOMING };
  for (const it of items) {
    if (it.amountPaise <= 0 || !it.dueDate) continue;
    out[upcomingBand(it.dueDate, now)] += it.amountPaise;
    out.total += it.amountPaise;
  }
  return out;
}
