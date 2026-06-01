import type { UserRole } from "./auth";

/**
 * Role-based access model (SALT-091). A role grants a default set of module
 * capabilities; per-user overrides (`grant`/`revoke`) layer on top. This is the
 * single source of truth consumed by `ProtectedRoute` (route gate), the sidebar
 * (`navConfig` visibility) and the Users & roles settings screen.
 */

export const ROLES: UserRole[] = ["owner", "manager", "accountant", "pharmacist", "cashier"];

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  manager: "Manager",
  accountant: "Accountant",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: "Full access, including settings and user management.",
  manager: "Runs day-to-day operations — everything except settings.",
  accountant: "Bills, parties, payments, GST and reports.",
  pharmacist: "Counter, inventory and catalogue.",
  cashier: "Counter billing only.",
};

/** Coarse, module-level capability keys (aligned with the nav modules). */
export type ModuleKey =
  | "counter"
  | "activity"
  | "approvals"
  | "purchases"
  | "sales"
  | "inventory"
  | "parties"
  | "payments"
  | "gst"
  | "reports"
  | "catalogue"
  | "salesmen"
  | "settings";

/** Modules an owner can grant/revoke per user. `counter` is intentionally omitted —
 *  it is the redirect target and is always allowed (see `can`). */
export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: "activity", label: "Activity feed" },
  { key: "approvals", label: "Approvals" },
  { key: "purchases", label: "Purchases / GRN" },
  { key: "sales", label: "Sales / bills" },
  { key: "inventory", label: "Inventory" },
  { key: "parties", label: "Parties" },
  { key: "payments", label: "Payments" },
  { key: "gst", label: "GST & compliance" },
  { key: "reports", label: "Reports" },
  { key: "catalogue", label: "Catalogue" },
  { key: "salesmen", label: "Salesmen" },
  { key: "settings", label: "Settings" },
];

const ALL: ModuleKey[] = [
  "counter", "activity", "approvals", "purchases", "sales", "inventory",
  "parties", "payments", "gst", "reports", "catalogue", "salesmen", "settings",
];

/** Default module set per role. `counter` is in every role (the landing screen). */
export const ROLE_MODULES: Record<UserRole, ModuleKey[]> = {
  owner: ALL,
  manager: ALL.filter((m) => m !== "settings"),
  accountant: ["counter", "activity", "sales", "parties", "payments", "gst", "reports"],
  pharmacist: ["counter", "activity", "approvals", "inventory", "catalogue"],
  cashier: ["counter", "activity", "approvals"],
};

export interface PermissionOverrides {
  grant?: ModuleKey[];
  revoke?: ModuleKey[];
}

/** Resolve whether a role (+ overrides) may use a module. revoke > grant > role default. */
export function can(
  role: UserRole | undefined,
  perms: PermissionOverrides | null | undefined,
  mod: ModuleKey,
): boolean {
  if (mod === "counter") return true; // always reachable — it is the redirect target
  if (!role) return false;
  if (perms?.revoke?.includes(mod)) return false;
  if (perms?.grant?.includes(mod)) return true;
  return ROLE_MODULES[role]?.includes(mod) ?? false;
}

/** The roles whose *default* set includes a module — drives sidebar visibility. */
export function rolesForModule(mod: ModuleKey): UserRole[] {
  return ROLES.filter((r) => ROLE_MODULES[r].includes(mod));
}

/** Map a route pathname to the module it belongs to. Unknown → settings (owner-only). */
export function pathModule(pathname: string): ModuleKey {
  const p = pathname;
  if (p === "/") return "counter";
  if (p.startsWith("/activity")) return "activity";
  if (p.startsWith("/approvals")) return "approvals";
  if (p.startsWith("/purchases")) return "purchases";
  if (p.startsWith("/bills")) return "sales";
  if (p.startsWith("/inventory")) return "inventory";
  if (p.startsWith("/parties")) return "parties";
  if (p.startsWith("/payments")) return "payments";
  if (p.startsWith("/gst")) return "gst";
  if (p.startsWith("/reports")) return "reports";
  if (p.startsWith("/catalogue")) return "catalogue";
  if (p.startsWith("/salesmen")) return "salesmen";
  // /settings, /owner, /import and anything unmapped → settings (most restrictive).
  return "settings";
}
