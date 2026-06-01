import {
  Activity,
  BarChart3,
  Contact,
  FileText,
  Keyboard,
  Landmark,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { rolesWith, type Permission, type UserRole } from "@/lib/permissions";

/** A sub-item under a module. `path` + `built` => navigable; otherwise shown disabled. */
export interface NavLeaf {
  label: string;
  path?: string;
  built: boolean;
}

/** A top-level module. `key` is its single-letter go-to shortcut (`g` then key). */
export interface NavModule {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Module landing route (only when built). */
  path?: string;
  built: boolean;
  /** Capability that gates this module (SALT-174) — the SSOT for access. */
  perm: Permission;
  /** Which roles see this module (derived from `perm` via the capability map). */
  roles: UserRole[];
  children: NavLeaf[];
}

/**
 * The whole IA, made visible. Built nodes link to existing routes; everything
 * else is `built: false` and renders disabled until we build it. This is the
 * single source of truth for the sidebar AND the keyboard go-to map.
 *
 * Each module declares the `perm` it needs; `roles` is derived from the
 * capability map (SALT-174) so nav visibility and route gating never drift.
 */
const MODULES: Array<Omit<NavModule, "roles">> = [
  {
    key: "c",
    label: "Counter",
    icon: Keyboard,
    path: "/",
    built: true,
    perm: "counter",
    children: [{ label: "Active bill", path: "/", built: true }],
  },
  {
    key: "v",
    label: "Activity",
    icon: Activity,
    path: "/activity",
    built: true,
    perm: "activity",
    children: [{ label: "Live feed", path: "/activity", built: true }],
  },
  {
    key: "o",
    label: "Approvals",
    icon: ShieldCheck,
    path: "/approvals",
    built: true,
    perm: "approvals",
    children: [{ label: "Manager inbox", path: "/approvals", built: true }],
  },
  {
    key: "p",
    label: "Purchases",
    icon: ShoppingCart,
    path: "/purchases",
    built: true,
    perm: "purchases",
    children: [
      { label: "Receive stock (GRN)", path: "/purchases/new", built: true },
      { label: "Scan invoice (OCR)", path: "/purchases/scan", built: true },
      { label: "GRN history", path: "/purchases", built: true },
      { label: "Purchase orders", path: "/purchases/orders", built: true },
      { label: "Reorder suggestions", path: "/purchases/orders/suggest", built: true },
      { label: "Vendor schemes", path: "/purchases/schemes", built: true },
      { label: "Debit notes", path: "/purchases/returns", built: true },
    ],
  },
  {
    key: "s",
    label: "Sales",
    icon: FileText,
    path: "/bills",
    built: true,
    perm: "sales",
    children: [
      { label: "Invoices", path: "/bills", built: true },
      { label: "Credit notes", built: false },
      { label: "H1 / X register", built: false },
    ],
  },
  {
    key: "i",
    label: "Inventory",
    icon: Package,
    path: "/inventory",
    built: true,
    perm: "inventory",
    children: [
      { label: "Stock ledger", path: "/inventory", built: true },
      { label: "Near expiry", path: "/inventory/near-expiry", built: true },
      { label: "Dead / slow stock", path: "/inventory/dead-stock", built: true },
      { label: "Reorder", path: "/inventory/reorder", built: true },
      { label: "Out of stock", path: "/inventory/out-of-stock", built: true },
      { label: "Turnover", path: "/inventory/turnover", built: true },
      { label: "Adjustments", path: "/inventory/adjustments", built: true },
      { label: "Physical count", path: "/inventory/count", built: true },
      { label: "Expiry destruction", path: "/inventory/destruction", built: true },
      { label: "Transfers", path: "/inventory/transfers", built: true },
    ],
  },
  {
    key: "a",
    label: "Parties",
    icon: Users,
    path: "/parties",
    built: true,
    perm: "parties",
    children: [
      { label: "All parties", path: "/parties", built: true },
      { label: "Customers", path: "/parties?type=customer", built: true },
      { label: "Vendors", path: "/parties?type=vendor", built: true },
    ],
  },
  {
    key: "m",
    label: "Payments",
    icon: Wallet,
    path: "/payments",
    built: true,
    perm: "payments",
    children: [
      { label: "Receive payment", path: "/payments", built: true },
      { label: "Make payment", path: "/payments/make", built: true },
      { label: "Bank reconciliation", built: false },
    ],
  },
  {
    key: "t",
    label: "GST & compliance",
    icon: Landmark,
    path: "/gst",
    built: true,
    perm: "gst",
    children: [
      { label: "GSTR-1", path: "/gst", built: true },
      { label: "GSTR-3B", path: "/gst/gstr3b", built: true },
      { label: "Liability", path: "/gst/liability", built: true },
      { label: "GSTR-2B recon", built: false },
      { label: "ITC register", path: "/gst/itc", built: true },
      { label: "Tally export", path: "/gst/tally", built: true },
      { label: "HSN summary", path: "/gst/hsn", built: true },
      { label: "H1 / X register", path: "/gst/h1", built: true },
      { label: "Drug licenses", built: false },
    ],
  },
  {
    key: "r",
    label: "Reports",
    icon: BarChart3,
    path: "/reports",
    built: true,
    perm: "reports",
    children: [
      { label: "Dashboard", path: "/reports", built: true },
      { label: "Sales reports", path: "/reports/sales", built: true },
      { label: "Purchase reports", path: "/reports/purchases", built: true },
      { label: "Inventory reports", path: "/reports/inventory", built: true },
      { label: "Financial reports", path: "/reports/financial", built: true },
      { label: "Tax reports", path: "/reports/tax", built: true },
    ],
  },
  {
    key: "k",
    label: "Catalogue",
    icon: Tag,
    path: "/catalogue",
    built: true,
    perm: "catalogue",
    children: [{ label: "Items", path: "/catalogue", built: true }],
  },
  {
    key: "e",
    label: "Salesmen",
    icon: Contact,
    path: "/salesmen",
    built: true,
    perm: "salesmen",
    children: [{ label: "All salesmen", path: "/salesmen", built: true }],
  },
  {
    key: ",",
    label: "Settings",
    icon: Settings,
    path: "/owner",
    built: true,
    perm: "settings",
    children: [
      { label: "Users & invites", path: "/owner", built: true },
      { label: "Import / migration", path: "/import", built: true },
      { label: "Organisation", path: "/settings/organisation", built: true },
      { label: "Shops", path: "/settings/shops", built: true },
      { label: "Drug licenses", path: "/settings/licenses", built: true },
      { label: "Print templates", path: "/settings/print", built: true },
      { label: "Data export", path: "/settings/export", built: true },
      { label: "Audit log", path: "/settings/audit", built: true },
      { label: "Data privacy", path: "/settings/privacy", built: true },
      { label: "Discount limits", path: "/settings/limits", built: true },
    ],
  },
];

/** Nav modules with `roles` filled in from the capability map (SALT-174). */
export const NAV: NavModule[] = MODULES.map((m) => ({ ...m, roles: rolesWith(m.perm) }));

/**
 * The first nav destination the member may open, given their `can`. Used as the
 * redirect target when a route is denied, so a role that lacks the counter (e.g.
 * an accountant) is never bounced into a redirect loop on "/".
 */
export function firstAllowedNavPath(can: (p: Permission) => boolean): string {
  for (const m of NAV) {
    if (m.built && m.path && can(m.perm)) return m.path;
  }
  return "/";
}
