import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useBill } from "@/store/bill";

interface ResolvedPrice {
  price_paise: number;
  rule_label: string;
}

/**
 * Customer-pricing resolution (SALT-191A). Whenever the bill's lines or the bound
 * party change, resolve each not-yet-priced (and non-overridden) line through the
 * `resolve_price` RPC and apply the winning rate + "why" label. A line records the
 * party it was priced for, so changing the customer re-prices the bill; a manual
 * override is left untouched.
 *
 * Graceful by design: any error (RPC missing because migration 0039 is unapplied,
 * offline, etc.) leaves the line at MRP — i.e. today's behaviour — so pricing can
 * never block the counter.
 */
export function usePriceResolution(shopId: string | null | undefined, partyId: string | null) {
  const lines = useBill((s) => s.lines);
  useEffect(() => {
    if (!supabase || !shopId) return;
    const partyKey = partyId ?? "";
    const pending = lines.filter((l) => !l.priceOverridden && l.pricedForParty !== partyKey);
    if (pending.length === 0) return;
    let active = true;
    for (const l of pending) {
      void supabase
        .rpc("resolve_price", {
          p_party_id: partyId,
          p_item_id: l.itemId,
          p_shop_id: shopId,
          p_mrp_paise: l.mrpPaise,
          p_cost_paise: l.ptrPaise,
        })
        .then(({ data, error }) => {
          if (!active || error) return; // keep MRP on any failure
          const row = (data as ResolvedPrice[] | null)?.[0];
          if (row) useBill.getState().applyResolvedPrice(l.key, row.price_paise, row.rule_label, partyKey);
        });
    }
    return () => {
      active = false;
    };
  }, [lines, partyId, shopId]);
}
