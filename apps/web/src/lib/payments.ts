/**
 * Payments domain — the client contract for the `record_payment` RPC and the
 * `payments` table (supabase/migrations/0021_payments.sql, live in the DB).
 *
 * Direction: `received` = money in from a customer (lowers their receivable);
 * `paid` = money out to a vendor (lowers our payable). The RPC posts the
 * cash/bank <-> party double entry server-side. Money is integer paise.
 *
 * Billing's lib/orders.ts has a minimal `buildPaymentPayload` (no notes); this
 * is the Payments module's own, fuller builder so we never edit billing's files.
 */
import { supabase } from "@/lib/supabase";
import { withTimeout } from "@/lib/orders";
import { formatPaise } from "@/lib/currency";

export type PaymentDirection = "received" | "paid";

/**
 * Modes `record_payment` accepts. The RPC routes `cash` -> CASH and the rest ->
 * BANK; `adjustment` is rejected by the RPC (it must go via a journal voucher),
 * so it is intentionally excluded here.
 */
export type PaymentMode = "cash" | "upi" | "card" | "cheque" | "bank";

export const PAYMENT_MODES: { value: PaymentMode; label: string; refLabel: string }[] = [
  { value: "cash", label: "Cash", refLabel: "Reference" },
  { value: "upi", label: "UPI", refLabel: "UPI txn ID" },
  { value: "card", label: "Card", refLabel: "Auth / txn no." },
  { value: "cheque", label: "Cheque", refLabel: "Cheque no." },
  { value: "bank", label: "Bank", refLabel: "UTR / NEFT ref" },
];

/** A row of the `payments` table — the subset the UI reads. */
export interface PaymentListRow {
  id: string;
  party_id: string;
  direction: PaymentDirection;
  payment_date: string;
  mode: string;
  amount_paise: number;
  reference: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

/** One line of a payment applied against a specific open document. */
export interface PaymentAllocationInput {
  target_table: "sales_invoice" | "purchase" | "ledger_bill";
  target_id: string;
  allocated_paise: number;
}

/**
 * `record_payment` args — keys match the SQL parameter names. `p_allocations`
 * applies the payment across specific open bills (omit => party-level only);
 * `p_salesman_id` attributes a received payment to the collecting salesman
 * (omit for vendor/outward). `p_payment_date` is left to its SQL default (today).
 */
export interface RecordPaymentArgs {
  p_shop_id: string;
  p_party_id: string;
  p_direction: PaymentDirection;
  p_mode: PaymentMode;
  p_amount_paise: number;
  p_reference: string | null;
  p_notes: string | null;
  p_allocations?: PaymentAllocationInput[];
  p_salesman_id?: string;
}

export function buildRecordPaymentArgs(input: {
  shopId: string;
  partyId: string;
  direction: PaymentDirection;
  mode: PaymentMode;
  amountPaise: number;
  reference?: string;
  notes?: string;
  allocations?: PaymentAllocationInput[];
  salesmanId?: string;
}): RecordPaymentArgs {
  const allocations = (input.allocations ?? []).filter((a) => a.allocated_paise > 0);
  return {
    p_shop_id: input.shopId,
    p_party_id: input.partyId,
    p_direction: input.direction,
    p_mode: input.mode,
    p_amount_paise: input.amountPaise,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
    ...(allocations.length ? { p_allocations: allocations } : {}),
    ...(input.salesmanId ? { p_salesman_id: input.salesmanId } : {}),
  };
}

/** Record a payment via the RPC (hard 15s timeout); returns the new payment id. */
export async function recordPayment(args: RecordPaymentArgs): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await withTimeout(supabase.rpc("record_payment", args), 15000);
  if (error) throw new Error(error.message);
  return data as string;
}

/** Signed paise for cash-flow stats: received = +in, paid = −out. */
export function signedAmount(p: { direction: PaymentDirection; amount_paise: number }): number {
  return p.direction === "received" ? p.amount_paise : -p.amount_paise;
}

/**
 * An open document to pay against (a vendor purchase or a customer sale). The
 * outstanding is derived on read — total − paid_paise − already-allocated —
 * because record_payment records allocations but does not move document
 * paid_paise (party-level netting lives in lib/orders `paymentsAdjustment`).
 */
export interface OpenDoc {
  target_table: "sales_invoice" | "purchase";
  target_id: string;
  ref: string | null;
  doc_date: string | null;
  outstanding_paise: number;
}

/** Allocate an amount across docs oldest-first; never over-allocates a doc. */
export function autoAllocate(amountPaise: number, docs: OpenDoc[]): Record<string, number> {
  let remaining = Math.max(0, amountPaise);
  const out: Record<string, number> = {};
  for (const d of docs) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, d.outstanding_paise);
    if (take > 0) {
      out[d.target_id] = take;
      remaining -= take;
    }
  }
  return out;
}

/** Sum of a per-doc allocation map (paise). */
export function allocatedTotal(alloc: Record<string, number>): number {
  return Object.values(alloc).reduce((sum, n) => sum + n, 0);
}

// --- Receipts (SALT-057) ----------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
  return n < 20 ? ONES[n] : (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
}
function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? under100(r) : ""].filter(Boolean).join(" ");
}
function rupeesToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  return [
    crore ? rupeesToWords(crore) + " Crore" : "",
    lakh ? under100(lakh) + " Lakh" : "",
    thousand ? under100(thousand) + " Thousand" : "",
    rest ? under1000(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Indian-system amount in words, e.g. 123450 → "One Thousand Two Hundred Thirty Four Rupees and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  const sign = paise < 0 ? "Minus " : "";
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const head = `${rupeesToWords(rupees)} Rupee${rupees === 1 ? "" : "s"}`;
  return `${sign}${head}${p ? ` and ${under100(p)} Paise` : ""} Only`;
}

/** A resolved allocation line for a receipt: which invoice, how much. */
export interface ReceiptAllocation {
  ref: string;
  allocated_paise: number;
}

/** Load a payment's allocations and resolve each to a human invoice ref. */
export async function loadPaymentAllocations(orgId: string, paymentId: string): Promise<ReceiptAllocation[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("payment_allocations")
    .select("target_table,target_id,allocated_paise")
    .eq("org_id", orgId)
    .eq("payment_id", paymentId);
  if (error || !data) return [];
  const rows = data as { target_table: string; target_id: string; allocated_paise: number }[];
  const refById = new Map<string, string>();
  const purchaseIds = rows.filter((r) => r.target_table === "purchase").map((r) => r.target_id);
  const saleIds = rows.filter((r) => r.target_table === "sales_invoice").map((r) => r.target_id);
  if (purchaseIds.length) {
    const { data: ps } = await supabase.from("purchases").select("id,vendor_invoice_no").in("id", purchaseIds);
    for (const p of (ps as { id: string; vendor_invoice_no: string | null }[] | null) ?? [])
      refById.set(p.id, p.vendor_invoice_no || "Purchase");
  }
  if (saleIds.length) {
    const { data: ss } = await supabase.from("sales_invoices").select("id,invoice_no").in("id", saleIds);
    for (const s of (ss as { id: string; invoice_no: string | null }[] | null) ?? [])
      refById.set(s.id, s.invoice_no || "Invoice");
  }
  return rows.map((r) => ({ ref: refById.get(r.target_id) ?? r.target_table, allocated_paise: r.allocated_paise }));
}

/** A WhatsApp-friendly receipt summary (plain text, wa.me encodes it). */
export function buildReceiptMessage(opts: {
  shopName?: string | null;
  direction: PaymentDirection;
  partyName: string;
  amountPaise: number;
  mode: string;
  reference?: string | null;
  dateLabel: string;
}): string {
  const verb = opts.direction === "received" ? "Received from" : "Paid to";
  return [
    opts.shopName?.trim() ? `*${opts.shopName.trim()}* — Payment Receipt` : "Payment Receipt",
    "",
    `${verb}: ${opts.partyName}`,
    `Amount: ${formatPaise(opts.amountPaise)}`,
    `Mode: ${opts.mode.toUpperCase()}${opts.reference?.trim() ? ` (${opts.reference.trim()})` : ""}`,
    `Date: ${opts.dateLabel}`,
    "",
    opts.direction === "received" ? "Thank you for your payment." : "Payment confirmation.",
  ].join("\n");
}

// --- Bank reconciliation (SALT-058) -----------------------------------------

/** A row of `bank_statement_lines` (the subset the recon UI reads). */
export interface BankStatementLine {
  id: string;
  txn_date: string | null;
  amount_paise: number; // signed: +credit / −debit
  description: string | null;
  reference: string | null;
}

/** A parsed-but-not-yet-saved statement line from an imported CSV. */
export type ParsedStatementLine = Omit<BankStatementLine, "id">;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else if (c === '"') quoted = true;
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Parse the common Indian bank-statement date shapes into YYYY-MM-DD. */
export function parseStatementDate(raw: string): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${y}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function csvToPaise(raw: string): number {
  const n = Number((raw || "").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/**
 * Parse a bank-statement CSV into signed paise lines. Detects a header row with
 * date / amount (or separate debit & credit) / description / reference columns;
 * credit is +, debit is −. Best-effort across the messy formats Indian banks export.
 */
export function parseStatementCsv(text: string): ParsedStatementLine[] {
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  if (!rows.length) return [];
  const header = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const di = find(/date/);
  const amtI = find(/amount|amt/);
  const debI = find(/debit|withdrawal/);
  const credI = find(/credit|deposit/);
  const descI = find(/desc|narration|particular|details|remark/);
  const refI = find(/ref|cheque|chq|utr|txn|transaction/);
  const hasHeader = di >= 0 || amtI >= 0 || debI >= 0 || credI >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ParsedStatementLine[] = [];
  for (const r of body) {
    const c = splitCsvLine(r);
    const txn_date = di >= 0 ? parseStatementDate(c[di] ?? "") : null;
    let amount_paise: number;
    if (amtI >= 0 && (c[amtI] ?? "").trim()) amount_paise = csvToPaise(c[amtI]);
    else amount_paise = (credI >= 0 ? csvToPaise(c[credI] ?? "") : 0) - (debI >= 0 ? csvToPaise(c[debI] ?? "") : 0);
    if (amount_paise === 0 && !txn_date) continue;
    out.push({
      txn_date,
      amount_paise,
      description: descI >= 0 ? c[descI] || null : null,
      reference: refI >= 0 ? c[refI] || null : null,
    });
  }
  return out;
}

function dayGap(a: string | null, b: string | null): number {
  if (!a || !b) return 1e9;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

export interface ReconResult {
  matched: { line: BankStatementLine; payment: PaymentListRow }[];
  unmatchedLines: BankStatementLine[];
  unmatchedPayments: PaymentListRow[];
}

/**
 * One-to-one auto-match of statement lines to recorded payments by signed
 * amount (a received payment is a bank credit; a paid payment, a debit), with
 * nearest payment-date as the tie-break. Leftovers are flagged on both sides.
 */
export function reconcile(lines: BankStatementLine[], payments: PaymentListRow[]): ReconResult {
  const used = new Set<string>();
  const matched: ReconResult["matched"] = [];
  const unmatchedLines: BankStatementLine[] = [];
  for (const line of lines) {
    const cands = payments
      .filter((p) => !used.has(p.id) && signedAmount(p) === line.amount_paise)
      .sort((a, b) => dayGap(a.payment_date, line.txn_date) - dayGap(b.payment_date, line.txn_date));
    if (cands.length === 0) {
      unmatchedLines.push(line);
      continue;
    }
    used.add(cands[0].id);
    matched.push({ line, payment: cands[0] });
  }
  return { matched, unmatchedLines, unmatchedPayments: payments.filter((p) => !used.has(p.id)) };
}
