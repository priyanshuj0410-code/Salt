import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/** A shop in the org, for the reports shop switcher. */
export interface OrgShop {
  id: string;
  name: string;
  isPrimary: boolean;
}

/** "All shops" sentinel for the shop filter. */
export const ALL_SHOPS = "all";

/**
 * Page-subtitle label for the active shop scope: a single-shop org just shows its
 * shop name; a multi-shop org shows "All shops" or the chosen shop's name.
 */
export function scopeLabelFor(shops: OrgShop[], shopFilter: string, shopName?: string | null): string {
  if (shops.length <= 1) return shopName ?? "This shop";
  if (shopFilter === ALL_SHOPS) return "All shops";
  return shops.find((s) => s.id === shopFilter)?.name ?? "Shop";
}

/**
 * The org's shops, primary first then oldest — backs the reports shop switcher
 * (SALT-118). One light read per org. Single-shop orgs get a one-element list so
 * the switcher can hide itself and reports just run org-wide.
 */
export function useOrgShops(): { shops: OrgShop[]; loading: boolean } {
  const orgId = useAuth().membership?.orgId;
  const [shops, setShops] = useState<OrgShop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("shops")
      .select("id,name,is_primary")
      .eq("org_id", orgId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        setShops(
          ((data as { id: string; name: string; is_primary: boolean }[] | null) ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            isPrimary: s.is_primary,
          })),
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  return { shops, loading };
}
