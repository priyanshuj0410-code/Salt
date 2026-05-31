import {
  BarChart3,
  FileText,
  Keyboard,
  Landmark,
  Package,
  Settings,
  ShoppingCart,
  Tag,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";

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
  /** Which roles see this module at all (role-gating, separate from build-state). */
  roles: UserRole[];
  children: NavLeaf[];
}

/**
 * The whole IA, made visible. Built nodes link to existing routes; everything
 * else is `built: false` and renders disabled until we build it. This is the
 * single source of truth for the sidebar AND the keyboard go-to map.
 */
export const NAV: NavModule[] = [
  {
    key: "c",
    label: "Counter",
    icon: Keyboard,
    path: "/",
    built: true,
    roles: ["owner", "cashier"],
    children: [{ label: "Active bill", path: "/", built: true }],
  },
  {
    key: "p",
    label: "Purchases",
    icon: ShoppingCart,
    path: "/purchases",
    built: true,
    roles: ["owner"],
    children: [
      { label: "Receive stock (GRN)", path: "/purchases/new", built: true },
      { label: "GRN history", path: "/purchases", built: true },
      { label: "Debit notes", built: false },
      { label: "Purchase orders", built: false },
    ],
  },
  {
    key: "s",
    label: "Sales",
    icon: FileText,
    path: "/bills",
    built: true,
    roles: ["owner"],
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
    built: false,
    roles: ["owner"],
    children: [
      { label: "Stock ledger", built: false },
      { label: "Near expiry", built: false },
      { label: "Dead / slow stock", built: false },
      { label: "Physical count", built: false },
    ],
  },
  {
    key: "a",
    label: "Parties",
    icon: Users,
    path: "/parties",
    built: true,
    roles: ["owner"],
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
    roles: ["owner"],
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
    roles: ["owner"],
    children: [
      { label: "GSTR-1", path: "/gst", built: true },
      { label: "GSTR-3B", path: "/gst/gstr3b", built: true },
      { label: "Liability", path: "/gst/liability", built: true },
      { label: "GSTR-2B recon", built: false },
      { label: "ITC register", built: false },
      { label: "H1 / X register", built: false },
      { label: "Drug licenses", built: false },
    ],
  },
  {
    key: "r",
    label: "Reports",
    icon: BarChart3,
    built: false,
    roles: ["owner"],
    children: [
      { label: "Dashboard", built: false },
      { label: "Sales reports", built: false },
      { label: "Purchase reports", built: false },
      { label: "Inventory reports", built: false },
      { label: "Financial reports", built: false },
    ],
  },
  {
    key: "k",
    label: "Catalogue",
    icon: Tag,
    built: false,
    roles: ["owner"],
    children: [
      { label: "Items", built: false },
      { label: "Item detail", built: false },
    ],
  },
  {
    key: ",",
    label: "Settings",
    icon: Settings,
    path: "/owner",
    built: true,
    roles: ["owner"],
    children: [
      { label: "Users & invites", path: "/owner", built: true },
      { label: "Import / migration", path: "/import", built: true },
      { label: "Organisation", path: "/settings/organisation", built: true },
      { label: "Drug licenses", built: false },
      { label: "Print templates", built: false },
    ],
  },
];
