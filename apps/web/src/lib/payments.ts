/**
 * Payments domain — the client contract for the `record_payment` RPC and the
 * `payments` table (supabase/proposed/0021_payments.sql, live in the DB).
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
 * applies the payment across specific open bills (omit => party-level only).
 * `p_payment_date` is left to its SQL default (today) — the RPC has no param.
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
