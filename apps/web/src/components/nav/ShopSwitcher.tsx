import { Store } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * Per-session active-shop switcher (SALT-173). Sets the working shop for the
 * session (auth context + localStorage) without touching the org-wide primary
 * (`is_primary`) — every shop-scoped screen reads `shopId`/`shop` from auth, so
 * the whole app follows the selection. Renders nothing for single-shop orgs.
 */
export function ShopSwitcher() {
  const { shops, shopId, setActiveShop } = useAuth();
  if (shops.length < 2) return null;

  return (
    <label className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground/80">
      <Store className="size-4 shrink-0" aria-hidden />
      <span className="sr-only">Active shop</span>
      <select
        value={shopId ?? ""}
        onChange={(e) => setActiveShop(e.target.value)}
        aria-label="Active shop"
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-sidebar px-1.5 text-xs focus-visible:border-ring"
      >
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
