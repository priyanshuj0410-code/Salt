import { supabase } from "./supabase";
import type { PaymentMethod } from "./types";

export interface CreditCheck {
  /** True only for a credit sale, with a limit set, that the bill pushes over. */
  over: boolean;
  limitPaise: number;
  /** Current outstanding before this bill. */
  duePaise: number;
  /** dues + this bill. */
  projectedPaise: number;
  /** max(0, projected − limit). */
  overByPaise: number;
  /** limit − dues (credit left before this bill; may be negative). */
  headroomPaise: number;
}

/**
 * Would a `billPaise` **credit** sale push a party over its credit limit, given current
 * `duePaise`? Cash sales settle immediately so never count; `limitPaise = 0` means no limit
 * set, so never over. Pure — the warning is advisory (non-blocking), decided by the caller.
 */
export function creditCheck(
  method: PaymentMethod,
  limitPaise: number,
  duePaise: number,
  billPaise: number,
): CreditCheck {
  const projectedPaise = duePaise + billPaise;
  const over = method === "credit" && limitPaise > 0 && projectedPaise > limitPaise;
  return {
    over,
    limitPaise,
    duePaise,
    projectedPaise,
    overByPaise: over ? projectedPaise - limitPaise : 0,
    headroomPaise: limitPaise - duePaise,
  };
}

/**
 * A party's credit limit + current outstanding dues. Delegates to the `party_credit` RPC
 * (SALT-213/214, migration 0047): a SECURITY DEFINER function that computes the same math
 * server-side — `opening_balance + Σ non-imported sales/purchase outstanding + payments
 * adjustment` (excluding imported `posts_effects = false` docs) — behind an `is_member` gate.
 *
 * This replaces four direct table reads (`ledgers` / `sales_invoices` / `purchases` / `payments`).
 * Those reads broke for non-owner cashiers once `payments` went owner-only (0044): RLS returned
 * `[]`, so dues were overstated by the party's total payments and the SALT-004 warning fired
 * falsely. The RPC works for any member, so the cashier credit check is correct again. Returns
 * null on missing party / error.
 */
export async function fetchPartyCredit(
  orgId: string,
  partyId: string,
): Promise<{ creditLimitPaise: number; duePaise: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .rpc("party_credit", { p_org: orgId, p_party: partyId })
    .maybeSingle();
  if (error) return null;
  const row = data as { credit_limit_paise: number; due_paise: number } | null;
  if (!row) return null;
  return { creditLimitPaise: row.credit_limit_paise, duePaise: row.due_paise };
}
