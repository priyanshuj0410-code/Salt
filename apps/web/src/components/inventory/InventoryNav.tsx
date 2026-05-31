import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/** The inventory module's sub-views, in display order. */
const TABS: { to: string; label: string }[] = [
  { to: "/inventory", label: "Stock ledger" },
  { to: "/inventory/near-expiry", label: "Near expiry" },
  { to: "/inventory/dead-stock", label: "Dead stock" },
  { to: "/inventory/reorder", label: "Reorder" },
  { to: "/inventory/out-of-stock", label: "Out of stock" },
  { to: "/inventory/turnover", label: "Turnover" },
  { to: "/inventory/adjustments", label: "Adjustments" },
  { to: "/inventory/count", label: "Physical count" },
];

/**
 * Segmented sub-navigation shared across the inventory read views. A horizontal,
 * scroll-on-overflow strip of links; the active route is highlighted. Each tab is
 * its own route (and sidebar leaf), so this is purely a convenience switcher.
 */
export function InventoryNav() {
  return (
    <div className="mb-5 -mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === "/inventory"}
          className={({ isActive }) =>
            cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-surface-2 text-text-primary"
                : "text-text-tertiary hover:bg-surface hover:text-text-secondary",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
