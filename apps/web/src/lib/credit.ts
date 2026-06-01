import { supabase } from "./supabase";
import { partyDue, paymentsAdjustment, type OrderRow } from "./orders";
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

type DocRow = { total_paise: number; paid_paise: number; posts_effects: boolean | null };
type PayRow = { direction: "received" | "paid"; amount_paise: number; posts_effects: boolean | null };

/**
 * A party's credit limit + current outstanding dues, matching the party-profile math:
 * `opening_balance + Σ non-imported orders + Σ live payments` (imported `posts_effects=false`
 * docs are already in the opening balance, so excluded). Returns null on missing party / error.
 */
export async function fetchPartyCredit(
  orgId: string,
  partyId: string,
): Promise<{ creditLimitPaise: number; duePaise: number } | null> {
  if (!supabase) return null;
  const [l, s, p, pay] = await Promise.all([
    supabase
      .from("ledgers")
      .select("credit_limit_paise,opening_balance_paise")
      .eq("org_id", orgId)
      .eq("id", partyId)
      .maybeSingle(),
    supabase.from("sales_invoices").select("total_paise,paid_paise,posts_effects").eq("party_id", partyId),
    supabase.from("purchases").select("total_paise,paid_paise,posts_effects").eq("vendor_id", partyId),
    supabase.from("payments").select("direction,amount_paise,posts_effects").eq("party_id", partyId),
  ]);
  const led = l.data as { credit_limit_paise: number; opening_balance_paise: number } | null;
  if (!led) return null;

  const toOrder =
    (direction: "sale" | "purchase") =>
    (r: DocRow, i: number): OrderRow => ({
      id: `${direction}${i}`,
      direction,
      total_paise: r.total_paise,
      paid_paise: r.paid_paise,
    });
  const sales = ((s.data as DocRow[] | null) ?? []).filter((r) => r.posts_effects !== false).map(toOrder("sale"));
  const purchases = ((p.data as DocRow[] | null) ?? []).filter((r) => r.posts_effects !== false).map(toOrder("purchase"));

  // payments.posts_effects (0029) may be absent on older DBs — on error, count all payments.
  let payRows = (pay.data as PayRow[] | null) ?? [];
  if (pay.error) {
    const fb = await supabase.from("payments").select("direction,amount_paise").eq("party_id", partyId);
    payRows = ((fb.data as Omit<PayRow, "posts_effects">[] | null) ?? []).map((r) => ({ ...r, posts_effects: null }));
  }
  const payments = payRows.filter((r) => r.posts_effects !== false);

  const duePaise = partyDue(led.opening_balance_paise, [...sales, ...purchases]) + paymentsAdjustment(payments);
  return { creditLimitPaise: led.credit_limit_paise, duePaise };
}
