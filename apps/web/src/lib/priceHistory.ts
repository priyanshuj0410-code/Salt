export interface PurchasePriceRow {
  mrpPaise: number;
  ptrPaise: number;
  qty: number;
  /** Sortable date string (YYYY-MM-DD or ISO) of the purchase. */
  date: string;
}

export interface PriceSummary {
  count: number;
  /** Most recent purchase, or null when there is no history. */
  latest: PurchasePriceRow | null;
  /** Median over buys with a positive value (robust to the odd zero/typo). */
  medianMrpPaise: number;
  medianPtrPaise: number;
}

function median(nums: number[]): number {
  const s = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Summarize an item's own recent GRN (purchase) prices — the latest buy plus the
 * median PTR/MRP — so the shop can set or sanity-check the catalogue price against
 * what it actually pays (SALT-082, within-shop). The cross-shop "crowd-sourced"
 * aggregation is a separate, schema-bearing job.
 */
export function summarizePurchasePrices(rows: PurchasePriceRow[]): PriceSummary {
  const latest = rows.length ? [...rows].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
  return {
    count: rows.length,
    latest,
    medianMrpPaise: median(rows.map((r) => r.mrpPaise)),
    medianPtrPaise: median(rows.map((r) => r.ptrPaise)),
  };
}
