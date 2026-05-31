/**
 * Reports & analytics — pure aggregation + shared helpers (no Supabase here, so
 * every function is unit-smoke-testable). The report pages fetch rows from the
 * document tables / the `v_*` report views (supabase/proposed/0023) and pass them
 * in. All money is integer **paise**.
 *
 * Basis (matches the GST module): operational reports read **placed/received,
 * non-imported** documents — `status` active + `posts_effects = true`. Pre-cutover
 * opening balances (imported into `ledgers.opening_balance_paise` / `ledger_bills`)
 * are the Parties module's starting point, not re-counted here. Where a report
 * needs the full receivable including openings it says so explicitly.
 */

// ---- Dates ------------------------------------------------------------------

/**
 * "Today" as YYYY-MM-DD in IST. India is single-timezone and the app runs on a
 * UTC cloud, so localising to Asia/Kolkata stops a post-18:30-IST clock from
 * stamping the day's sales onto tomorrow (a real "today's total" bug).
 */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

/** The current month as 'YYYY-MM' in IST. */
export function istMonth(now: Date = new Date()): string {
  return istToday(now).slice(0, 7);
}

/** [start, end) — first day of `period` ('YYYY-MM') and first day of the next. */
export function monthRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  return { start: `${period}-01`, end: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) };
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

// ---- Sales: top items + cash/credit split -----------------------------------

/** A `sale_lines` row, the shape the dashboard / sales reports fetch. */
export interface SoldLineRow {
  item_id: string | null;
  name: string;
  qty: number;
  line_total_paise: number;
}

/** One item rolled up across its sale lines. */
export interface ItemSold {
  itemId: string | null;
  name: string;
  qty: number;
  valuePaise: number;
}

/** Roll sale lines up per item and return the busiest `limit`, qty-first. */
export function topItemsSold(lines: SoldLineRow[], limit = 10): ItemSold[] {
  const map = new Map<string, ItemSold>();
  for (const l of lines) {
    const key = l.item_id ?? `name:${l.name}`;
    let row = map.get(key);
    if (!row) {
      row = { itemId: l.item_id, name: l.name || "—", qty: 0, valuePaise: 0 };
      map.set(key, row);
    }
    row.qty += l.qty;
    row.valuePaise += l.line_total_paise;
  }
  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty || b.valuePaise - a.valuePaise)
    .slice(0, limit);
}

/** Methods that settle at the counter (vs. `credit`, which creates a receivable). */
const PAID_NOW = new Set(["cash", "card", "upi", "bank"]);

/** An invoice's payment method + value, for the cash-vs-credit split. */
export interface PayMethodRow {
  payment_method: string | null;
  total_paise: number;
}

export interface CashCreditSplit {
  cashPaise: number;
  creditPaise: number;
  cashCount: number;
  creditCount: number;
}

/** Split invoices into paid-at-counter ("cash") vs credit. Null method = credit. */
export function cashCreditSplit(rows: PayMethodRow[]): CashCreditSplit {
  const out: CashCreditSplit = { cashPaise: 0, creditPaise: 0, cashCount: 0, creditCount: 0 };
  for (const r of rows) {
    if (r.payment_method && PAID_NOW.has(r.payment_method)) {
      out.cashPaise += r.total_paise;
      out.cashCount += 1;
    } else {
      out.creditPaise += r.total_paise;
      out.creditCount += 1;
    }
  }
  return out;
}

// ---- Drug licenses ----------------------------------------------------------

export interface LicenseRow {
  license_type: string;
  license_no: string;
  holder_name: string | null;
  expiry_date: string | null;
}

export interface LicenseSummary {
  total: number;
  expired: number;
  expiring: number; // within `warnDays`
  ok: number;
  unknown: number; // no expiry recorded
  soonest: LicenseRow | null;
}

/** Classify licenses by days-to-expiry; `soonest` is the nearest dated expiry. */
export function summarizeLicenses(rows: LicenseRow[], today: string, warnDays = 90): LicenseSummary {
  const out: LicenseSummary = { total: rows.length, expired: 0, expiring: 0, ok: 0, unknown: 0, soonest: null };
  for (const r of rows) {
    if (!r.expiry_date) {
      out.unknown += 1;
      continue;
    }
    const days = daysBetween(today, r.expiry_date);
    if (days < 0) out.expired += 1;
    else if (days <= warnDays) out.expiring += 1;
    else out.ok += 1;
    if (!out.soonest || (out.soonest.expiry_date && r.expiry_date < out.soonest.expiry_date)) out.soonest = r;
  }
  return out;
}

// ---- Aging views (v_receivables_aging / v_payables_aging) -------------------

/** A row from `v_receivables_aging` / `v_payables_aging` (party name column renamed). */
export interface AgingViewRow {
  party_id: string;
  name: string;
  outstanding_paise: number;
  d0_30_paise: number;
  d31_60_paise: number;
  d61_90_paise: number;
  d90_plus_paise: number;
}

export interface AgingTotals {
  outstandingPaise: number;
  over30Paise: number; // 31-60 + 61-90 + 90+
  d0_30Paise: number;
  d31_60Paise: number;
  d61_90Paise: number;
  d90_plusPaise: number;
  parties: number; // rows with a positive outstanding
  over30Parties: number; // rows with any balance older than 30 days
}

/** Sum an aging view into headline totals + the "overdue (>30d)" cut. */
export function sumAging(rows: AgingViewRow[]): AgingTotals {
  const t: AgingTotals = {
    outstandingPaise: 0,
    over30Paise: 0,
    d0_30Paise: 0,
    d31_60Paise: 0,
    d61_90Paise: 0,
    d90_plusPaise: 0,
    parties: 0,
    over30Parties: 0,
  };
  for (const r of rows) {
    if (r.outstanding_paise > 0) t.parties += 1;
    const over30 = r.d31_60_paise + r.d61_90_paise + r.d90_plus_paise;
    t.outstandingPaise += r.outstanding_paise;
    t.over30Paise += over30;
    t.d0_30Paise += r.d0_30_paise;
    t.d31_60Paise += r.d31_60_paise;
    t.d61_90Paise += r.d61_90_paise;
    t.d90_plusPaise += r.d90_plus_paise;
    if (over30 > 0) t.over30Parties += 1;
  }
  return t;
}

// ---- CSV export -------------------------------------------------------------

/** paise → a plain rupee string with 2 decimals (for CSV/exports, no symbol). */
export const paiseToRupeeStr = (p: number): string => (Math.round(p) / 100).toFixed(2);

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from a header row + value rows. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Trigger a client-side file download (same blob pattern as the GST exports). */
export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Build + download a CSV in one call. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  downloadText(filename, toCsv(headers, rows), "text/csv;charset=utf-8");
}
