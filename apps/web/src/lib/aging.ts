/**
 * Receivables / payables aging — splits a party's outstanding into the standard
 * 0-30 / 31-60 / 61-90 / 90+ day bands so collections can be prioritised.
 *
 * Basis (matches `partyDue` in ./orders): the dated open items that compose the
 * amount due — imported open bills (`ledger_bills`, which net into the opening
 * balance) plus post-cutover unpaid orders. Recorded ad-hoc payments reduce the
 * balance but carry no date, so they are not allocated here; this is "aging of
 * open items", shown alongside the exact net due.
 */

export interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export const EMPTY_AGING: AgingBuckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };

/** Display order + labels for the four bands. */
export const AGING_BANDS: { key: Exclude<keyof AgingBuckets, "total">; label: string }[] = [
  { key: "d0_30", label: "0–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
];

const MS_PER_DAY = 86_400_000;

/**
 * Whole days overdue: today − due date. Negative (not yet due) lands in 0-30.
 * Falls back to `fallback` (e.g. bill/order date) when no due date is set.
 */
export function ageInDays(
  due: string | null | undefined,
  fallback?: string | null,
  now: Date = new Date(),
): number {
  const iso = due ?? fallback ?? null;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

function bandKey(ageDays: number): Exclude<keyof AgingBuckets, "total"> {
  if (ageDays <= 30) return "d0_30";
  if (ageDays <= 60) return "d31_60";
  if (ageDays <= 90) return "d61_90";
  return "d90_plus";
}

/** One dated outstanding amount; `amountPaise` is a magnitude (≥ 0). */
export interface AgingItem {
  amountPaise: number;
  ageDays: number;
}

/** Sum dated outstanding magnitudes into aging bands (non-positive amounts skipped). */
export function bucketize(items: AgingItem[]): AgingBuckets {
  const out: AgingBuckets = { ...EMPTY_AGING };
  for (const it of items) {
    if (it.amountPaise <= 0) continue;
    out[bandKey(it.ageDays)] += it.amountPaise;
    out.total += it.amountPaise;
  }
  return out;
}

/** A dated open bill from `ledger_bills` (imported opening-balance breakdown). */
export interface AgingBill {
  amount_paise: number;
  nature: string | null; // 'dr' = receivable, 'cr' = payable
  due_date: string | null;
  bill_date?: string | null;
  days_overdue: number | null;
}

/** A post-cutover order contributing to dues (sale = receivable, purchase = payable). */
export interface AgingOrder {
  direction: "sale" | "purchase";
  total_paise: number;
  paid_paise: number;
  due_date: string | null;
  created_at: string;
  /** Imported historical doc (posts_effects=false): already in the opening balance — excluded. */
  imported: boolean;
}

/** Split open bills + post-cutover orders into receivable and payable aging. */
export function agingFor(
  bills: AgingBill[],
  orders: AgingOrder[],
  now: Date = new Date(),
): { receivable: AgingBuckets; payable: AgingBuckets } {
  const receivable: AgingItem[] = [];
  const payable: AgingItem[] = [];

  for (const b of bills) {
    const age = b.days_overdue ?? ageInDays(b.due_date, b.bill_date, now);
    const item = { amountPaise: b.amount_paise, ageDays: age };
    if (b.nature === "cr") payable.push(item);
    else receivable.push(item); // default/dr = receivable
  }

  for (const o of orders) {
    if (o.imported) continue;
    const unpaid = o.total_paise - o.paid_paise;
    if (unpaid <= 0) continue;
    const age = ageInDays(o.due_date, o.created_at, now);
    (o.direction === "purchase" ? payable : receivable).push({ amountPaise: unpaid, ageDays: age });
  }

  return { receivable: bucketize(receivable), payable: bucketize(payable) };
}
