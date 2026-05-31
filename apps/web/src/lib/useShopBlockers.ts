import { useAuth, type Shop } from "@/lib/auth";

/** Fields the user must fill before sale/purchase RPCs accept the call. */
export type BlockerField = "state_code" | "gstin" | "name";

export interface ShopBlockers {
  /** True only when we know the shop exists AND has all required fields. */
  ready: boolean;
  /** Hard-blocking fields that, if missing, will make the RPC raise. */
  missing: BlockerField[];
  /** Soft-warning fields (e.g. GSTIN is invoice-compliance, not RPC-blocking). */
  warnings: BlockerField[];
  /** The current shop record (or null if no shop is resolved yet). */
  shop: Shop | null;
}

/**
 * Detects whether the user's primary shop has the fields the new sale/purchase
 * RPCs (proposed/0018, 0019) need. Today the only HARD blocker is
 * `state_code`: without it, `is_interstate` computes to NULL and the
 * NOT-NULL constraint on `sales_invoices`/`purchases` rejects the insert.
 * GSTIN is required by D&C Rules on the printed invoice but the RPC doesn't
 * reject on it — we surface it as a warning so the rescue dialog still asks.
 */
export function useShopBlockers(): ShopBlockers {
  const shop = useAuth().shop;
  if (!shop) {
    return { ready: false, missing: ["name"], warnings: [], shop: null };
  }
  const missing: BlockerField[] = [];
  if (!shop.state_code) missing.push("state_code");
  if (!shop.name) missing.push("name");
  const warnings: BlockerField[] = [];
  if (!shop.gstin) warnings.push("gstin");
  return { ready: missing.length === 0, missing, warnings, shop };
}
