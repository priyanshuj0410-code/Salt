/**
 * Reports & analytics — pure aggregation + shared helpers (no Supabase here, so
 * every function is unit-smoke-testable). The report pages fetch rows from the
 * document tables / the `v_*` report views (supabase/migrations/0023_reports.sql) and pass them
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

export type RangePreset = "today" | "month" | "last-month" | "fy";

/**
 * Common date-range presets as inclusive [from, to]. The Indian financial year
 * runs Apr 1 → Mar 31, so "This FY" starts on the most recent April 1st.
 */
export function presetRange(preset: RangePreset, today: string = istToday()): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number); // m is 1-12
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDayOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (preset === "today") return { from: today, to: today };
  if (preset === "month") return { from: `${y}-${pad(m)}-01`, to: today };
  if (preset === "last-month") {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDayOfMonth(ly, lm))}` };
  }
  const fyStartYear = m >= 4 ? y : y - 1; // before April ⇒ FY started last calendar year
  return { from: `${fyStartYear}-04-01`, to: today };
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
      row = { itemId: l.item_id, name: l.name || "-", qty: 0, valuePaise: 0 };
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

// ---- Generic rollups (items / categories / parties), reused across suites ---

/** Minimum line shape for {@link rollupLines} — a sold/received line. */
export interface RollupLineInput {
  qty: number;
  taxable_paise: number;
  line_total_paise: number;
}

/** A line group (per item, per GST rate, per schedule…), value-ranked. */
export interface LineGroup {
  key: string;
  label: string;
  qty: number;
  taxablePaise: number;
  totalPaise: number;
  lines: number;
}

/** Group lines by `keyOf`, summing qty / taxable / total; sorted by value desc. */
export function rollupLines<T extends RollupLineInput>(
  rows: T[],
  keyOf: (r: T) => string,
  labelOf: (r: T) => string,
): LineGroup[] {
  const map = new Map<string, LineGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    let g = map.get(key);
    if (!g) {
      g = { key, label: labelOf(r), qty: 0, taxablePaise: 0, totalPaise: 0, lines: 0 };
      map.set(key, g);
    }
    g.qty += r.qty;
    g.taxablePaise += r.taxable_paise;
    g.totalPaise += r.line_total_paise;
    g.lines += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.totalPaise - a.totalPaise);
}

/** Minimum document shape for {@link rollupParties} — a dated invoice/GRN. */
export interface RollupDocInput {
  total_paise: number;
  taxable_paise: number;
  paid_paise: number;
  date: string;
}

/** A party group (customer / vendor / cashier), value-ranked, with outstanding + last activity. */
export interface PartyGroup {
  key: string;
  name: string;
  docs: number;
  totalPaise: number;
  taxablePaise: number;
  paidPaise: number;
  outstandingPaise: number;
  lastDate: string;
}

/** Group documents by `keyOf` (party/vendor/cashier), summing value + tracking last activity. */
export function rollupParties<T extends RollupDocInput>(
  rows: T[],
  keyOf: (r: T) => string,
  nameOf: (r: T) => string,
): PartyGroup[] {
  const map = new Map<string, PartyGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    let g = map.get(key);
    if (!g) {
      g = { key, name: nameOf(r), docs: 0, totalPaise: 0, taxablePaise: 0, paidPaise: 0, outstandingPaise: 0, lastDate: r.date };
      map.set(key, g);
    }
    g.docs += 1;
    g.totalPaise += r.total_paise;
    g.taxablePaise += r.taxable_paise;
    g.paidPaise += r.paid_paise;
    if (r.date > g.lastDate) g.lastDate = r.date;
  }
  for (const g of map.values()) g.outstandingPaise = g.totalPaise - g.paidPaise;
  return Array.from(map.values()).sort((a, b) => b.totalPaise - a.totalPaise);
}

/** Sum a numeric field across rows. */
export function sumBy<T>(rows: T[], pick: (r: T) => number): number {
  return rows.reduce((s, r) => s + pick(r), 0);
}

/** A `v_stock_on_hand` row (one batch in stock). */
export interface StockRow {
  item_id: string | null;
  item_name: string;
  qty: number;
  mrp_paise: number;
  ptr_paise: number;
  stock_value_paise: number; // qty * ptr (cost), per the view
}

/** An item's stock rolled up across its batches, valued at cost (PTR) and MRP. */
export interface StockItemAgg {
  itemId: string | null;
  name: string;
  qty: number;
  batches: number;
  costPaise: number;
  mrpPaise: number;
}

/**
 * Roll batches up per item for the valuation / low-stock views. Cost is the
 * view's `stock_value_paise` (qty × batch PTR — batch-level cost ≈ weighted
 * average); retail is qty × batch MRP. Sorted by cost value desc.
 */
export function rollupStock(rows: StockRow[]): StockItemAgg[] {
  const map = new Map<string, StockItemAgg>();
  for (const r of rows) {
    const key = r.item_id ?? `name:${r.item_name}`;
    let g = map.get(key);
    if (!g) {
      g = { itemId: r.item_id, name: r.item_name, qty: 0, batches: 0, costPaise: 0, mrpPaise: 0 };
      map.set(key, g);
    }
    g.qty += r.qty;
    g.batches += 1;
    g.costPaise += r.stock_value_paise;
    g.mrpPaise += r.qty * r.mrp_paise;
  }
  return Array.from(map.values()).sort((a, b) => b.costPaise - a.costPaise);
}

/** An item with its configured reorder level (from `items`). */
export interface ReorderInput {
  id: string;
  name: string;
  reorder_level: number;
}

/** A reorder candidate: on-hand at/below its reorder level (incl. out of stock). */
export interface ReorderItem {
  itemId: string;
  name: string;
  reorderLevel: number;
  onHand: number;
  shortfall: number;
}

/**
 * Items needing reorder: those with a positive `reorder_level` whose on-hand
 * (0 when absent from stock — the most urgent case `v_stock_on_hand` can't show)
 * is at or below it. Sorted by shortfall, biggest gap first.
 */
export function reorderList(items: ReorderInput[], onHandByItem: Map<string, number>): ReorderItem[] {
  return items
    .filter((i) => i.reorder_level > 0)
    .map((i) => {
      const onHand = onHandByItem.get(i.id) ?? 0;
      return { itemId: i.id, name: i.name, reorderLevel: i.reorder_level, onHand, shortfall: i.reorder_level - onHand };
    })
    .filter((r) => r.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall);
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

// ---- Accounting statements (from the double-entry ledger / views) -----------

/** A `v_trial_balance` row: net balance = Σdebit − Σcredit for an account/party. */
export interface TrialBalanceRow {
  code: string | null;
  name: string;
  type: string;
  balance_paise: number;
}

export interface TrialBalanceLine {
  code: string | null;
  name: string;
  type: string;
  debitPaise: number;
  creditPaise: number;
}

export interface TrialBalance {
  lines: TrialBalanceLine[];
  totalDebitPaise: number;
  totalCreditPaise: number;
}

/** Split each net balance into a debit/credit column (a balanced book ties). */
export function buildTrialBalance(rows: TrialBalanceRow[]): TrialBalance {
  const lines: TrialBalanceLine[] = rows
    .map((r) => ({
      code: r.code,
      name: r.name,
      type: r.type,
      debitPaise: r.balance_paise > 0 ? r.balance_paise : 0,
      creditPaise: r.balance_paise < 0 ? -r.balance_paise : 0,
    }))
    .filter((l) => l.debitPaise !== 0 || l.creditPaise !== 0)
    .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name));
  return {
    lines,
    totalDebitPaise: lines.reduce((s, l) => s + l.debitPaise, 0),
    totalCreditPaise: lines.reduce((s, l) => s + l.creditPaise, 0),
  };
}

/** A ledger entry against a chart account (party entries are excluded from P&L). */
export interface AccountEntry {
  debitPaise: number;
  creditPaise: number;
  type: string;
  name: string;
}

export interface PnlLine {
  name: string;
  amountPaise: number;
}

export interface Pnl {
  income: PnlLine[];
  expense: PnlLine[];
  incomeTotalPaise: number;
  expenseTotalPaise: number;
  netPaise: number; // income − expense (profit if > 0)
}

/**
 * Accrual P&L from ledger entries: income accounts are credit-normal
 * (credit − debit), expense accounts debit-normal (debit − credit). Pass entries
 * for the period to get a period P&L.
 */
export function buildPnl(entries: AccountEntry[]): Pnl {
  const inc = new Map<string, number>();
  const exp = new Map<string, number>();
  for (const e of entries) {
    if (e.type === "income") inc.set(e.name, (inc.get(e.name) ?? 0) + (e.creditPaise - e.debitPaise));
    else if (e.type === "expense") exp.set(e.name, (exp.get(e.name) ?? 0) + (e.debitPaise - e.creditPaise));
  }
  const toLines = (m: Map<string, number>) =>
    Array.from(m, ([name, amountPaise]) => ({ name, amountPaise })).sort((a, b) => b.amountPaise - a.amountPaise);
  const income = toLines(inc);
  const expense = toLines(exp);
  const incomeTotalPaise = income.reduce((s, l) => s + l.amountPaise, 0);
  const expenseTotalPaise = expense.reduce((s, l) => s + l.amountPaise, 0);
  return { income, expense, incomeTotalPaise, expenseTotalPaise, netPaise: incomeTotalPaise - expenseTotalPaise };
}

/** A `v_balance_sheet` row (asset/liability/equity accounts only). */
export interface BalanceSheetRow {
  type: string;
  name: string;
  balance_paise: number;
}

export interface BalanceSheet {
  assets: PnlLine[];
  liabilities: PnlLine[];
  equity: PnlLine[];
  assetsTotalPaise: number;
  liabilitiesAndEquityTotalPaise: number;
}

/**
 * Balance sheet from account balances. Assets are debit-normal (use the balance
 * as-is); liabilities/equity are credit-normal (negate). `retainedEarningsPaise`
 * (all-time net P&L) is folded into equity so assets ≈ liabilities + equity.
 */
export function buildBalanceSheet(rows: BalanceSheetRow[], retainedEarningsPaise: number): BalanceSheet {
  const assets: PnlLine[] = [];
  const liabilities: PnlLine[] = [];
  const equity: PnlLine[] = [];
  for (const r of rows) {
    if (r.balance_paise === 0) continue;
    if (r.type === "asset") assets.push({ name: r.name, amountPaise: r.balance_paise });
    else if (r.type === "liability") liabilities.push({ name: r.name, amountPaise: -r.balance_paise });
    else if (r.type === "equity") equity.push({ name: r.name, amountPaise: -r.balance_paise });
  }
  if (retainedEarningsPaise !== 0) equity.push({ name: "Retained earnings (P&L)", amountPaise: retainedEarningsPaise });
  const sum = (xs: PnlLine[]) => xs.reduce((s, l) => s + l.amountPaise, 0);
  const liabilitiesTotal = sum(liabilities);
  const equityTotal = sum(equity);
  return {
    assets,
    liabilities,
    equity,
    assetsTotalPaise: sum(assets),
    liabilitiesAndEquityTotalPaise: liabilitiesTotal + equityTotal,
  };
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
