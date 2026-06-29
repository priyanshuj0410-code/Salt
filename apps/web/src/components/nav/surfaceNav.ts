import { Bike, Home, Landmark, Package, Settings, Store, Truck, Wallet } from "lucide-react";

import { pathModule } from "@/lib/permissions";
import type { SurfaceKey } from "@/lib/lens/surfaces";
import type { Lens } from "@/lib/lens/deriveLens";
import type { NavLeaf, NavModule } from "./navConfig";

/**
 * The V2 surface nav (WS2 Slice 1) — the 8 surfaces as the sidebar's top level,
 * shown only when LENS_V2 is on (V1's 13-module NAV stays the else-branch). Each
 * leaf points at its EXISTING V1 URL — surfaces regroup routes, they don't rename
 * them. Extends NavModule so the existing ModuleItem/IconItem render it unchanged;
 * `surface` is the key the lens lights, `key` is the (future) go-to chord.
 *
 * Leaves are filtered per-route by the module gate (lens.litModules) at render,
 * so a surface a user holds still only shows the sub-areas they can actually reach.
 */
export interface SurfaceNav extends NavModule {
  surface: SurfaceKey;
}

const leaf = (label: string, path: string): NavLeaf => ({ label, path, built: true });

export const SURFACE_NAV: SurfaceNav[] = [
  {
    surface: "home", key: "h", label: "Home", icon: Home, path: "/reports", built: true, roles: [],
    children: [leaf("Dashboard", "/reports"), leaf("Activity", "/activity"), leaf("Approvals", "/approvals")],
  },
  {
    surface: "counter", key: "c", label: "Counter", icon: Store, path: "/", built: true, roles: [],
    children: [leaf("Active bill", "/"), leaf("Invoices", "/bills"), leaf("Credit notes", "/bills/credit-notes")],
  },
  {
    surface: "buy", key: "b", label: "Buy", icon: Truck, path: "/purchases", built: true, roles: [],
    children: [
      leaf("Receive (GRN)", "/purchases"), leaf("New GRN", "/purchases/new"), leaf("Import (scan)", "/purchases/scan"),
      leaf("Purchase orders", "/purchases/orders"), leaf("Vendor schemes", "/purchases/schemes"), leaf("Returns", "/purchases/returns"),
    ],
  },
  {
    surface: "stock", key: "s", label: "Stock", icon: Package, path: "/inventory", built: true, roles: [],
    children: [
      leaf("Stock", "/inventory"), leaf("Near expiry", "/inventory/near-expiry"), leaf("Dead stock", "/inventory/dead-stock"),
      leaf("Reorder", "/inventory/reorder"), leaf("Catalogue", "/catalogue"),
    ],
  },
  {
    surface: "money", key: "m", label: "Money", icon: Wallet, path: "/parties", built: true, roles: [],
    children: [
      leaf("Parties", "/parties"), leaf("Payments", "/payments"), leaf("Make payment", "/payments/make"), leaf("Financial reports", "/reports/financial"),
    ],
  },
  {
    surface: "comply", key: "t", label: "Comply", icon: Landmark, path: "/gst", built: true, roles: [],
    children: [
      leaf("GSTR-1", "/gst"), leaf("GSTR-3B", "/gst/gstr3b"), leaf("Liability", "/gst/liability"), leaf("ITC register", "/gst/itc"),
      leaf("HSN summary", "/gst/hsn"), leaf("Tally export", "/gst/tally"), leaf("Invoice series", "/gst/series"), leaf("Drug licenses", "/settings/licenses"),
    ],
  },
  {
    surface: "field", key: "f", label: "Field", icon: Bike, path: "/salesmen", built: true, roles: [],
    children: [leaf("Salesmen", "/salesmen")],
  },
  {
    surface: "setup", key: ",", label: "Setup", icon: Settings, path: "/owner", built: true, roles: [],
    children: [
      leaf("Users & invites", "/owner"), leaf("Roles & permissions", "/settings/users"), leaf("Organisation", "/settings/organisation"),
      leaf("Shops", "/settings/shops"), leaf("Import / migration", "/import"), leaf("Print templates", "/settings/print"),
      leaf("Export", "/settings/export"), leaf("Audit log", "/settings/audit"), leaf("Integrations", "/settings/integrations/whatsapp"),
    ],
  },
];

/**
 * The surfaces this user sees, each with only the leaves they can reach — the ONE
 * source the sidebar, the go-to chords, and the command palette all consume under
 * LENS_V2, so they can never drift. Surface lit by `lens.surfaces`; leaves gated by
 * the module gate (`lens.litModules`); empty surfaces dropped; each surface's own
 * link points at its first reachable leaf so it never lands on a gated route.
 */
export function visibleSurfaces(lens: Lens): SurfaceNav[] {
  return SURFACE_NAV.filter((s) => lens.surfaces.has(s.surface))
    .map((s) => {
      const children = s.children.filter((c) => c.path != null && lens.litModules.has(pathModule(c.path)));
      return { ...s, path: children[0]?.path ?? s.path, children };
    })
    .filter((s) => s.children.length > 0);
}
