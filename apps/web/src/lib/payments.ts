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

/**
 * `record_payment` args — keys match the SQL parameter names. `p_allocations`
 * (apply across specific open bills) and `p_payment_date` are left to their SQL
 * defaults (null / today) for now; allocation UI lands with SALT-056/061.
 */
export interface RecordPaymentArgs {
  p_shop_id: string;
  p_party_id: string;
  p_direction: PaymentDirection;
  p_mode: PaymentMode;
  p_amount_paise: number;
  p_reference: string | null;
  p_notes: string | null;
}

export function buildRecordPaymentArgs(input: {
  shopId: string;
  partyId: string;
  direction: PaymentDirection;
  mode: PaymentMode;
  amountPaise: number;
  reference?: string;
  notes?: string;
}): RecordPaymentArgs {
  return {
    p_shop_id: input.shopId,
    p_party_id: input.partyId,
    p_direction: input.direction,
    p_mode: input.mode,
    p_amount_paise: input.amountPaise,
    p_reference: input.reference?.trim() || null,
    p_notes: input.notes?.trim() || null,
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
