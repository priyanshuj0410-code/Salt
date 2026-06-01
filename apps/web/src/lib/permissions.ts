/**
 * Roles & permissions model (SALT-174).
 *
 * The single source of truth for *who can do what*. Five roles, each mapped to a
 * set of capability `Permission`s, plus per-user overrides layered on top. This
 * module is pure and imports nothing app-internal so it can be consumed by both
 * `auth.tsx` (the `can()` helper) and `navConfig.ts` (deriving per-module roles)
 * without an import cycle.
 *
 * Enforcement is layered:
 *  - the DB is the real boundary — RLS + `has_role()` gate the financial tables
 *    (see migrations 0043/0044); the books (GL) are owner/manager/accountant only.
 *  - this map gates the *UI* — which routes a role may open (`ProtectedRoute`)
 *    and which modules show in the nav (`navConfig.roles`).
 *
 * SALT-091 (Settings → Users & roles) builds the management UI on top of this.
 */

/** A membership role. Widened from the original owner/cashier pair (SALT-174). */
export type UserRole = "owner" | "manager" | "pharmacist" | "cashier" | "accountant";

/** Display order + iteration order for the five roles. */
export const USER_ROLES: UserRole[] = ["owner", "manager", "pharmacist", "cashier", "accountant"];

/** Human label for a role (the enum value is lower-case). */
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  manager: "Manager",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
  accountant: "Accountant",
};

/**
 * A capability. Mostly one-per-nav-module (gating which screens a role opens),
 * plus a couple of pure *action* capabilities (`manage_users`, `approve_discounts`)
 * that screens consult directly via `can()` rather than via routing.
 */
export type Permission =
  | "counter" // ring sales at the billing counter
  | "activity" // shop-wide activity feed
  | "approvals" // manager approval inbox
  | "parties" // customers / vendors ledgers
  | "purchases" // GRN, purchase orders, debit notes
  | "sales" // sales-invoice history, credit notes
  | "inventory" // stock ledger, adjustments, counts
  | "payments" // receive / make payments
  | "gst" // GST returns & compliance
  | "reports" // reporting suites
  | "catalogue" // item master
  | "salesmen" // field-salesman management
  | "imports" // data import / migration
  | "settings" // org / shop configuration area
  | "manage_users" // invite members + assign roles
  | "approve_discounts"; // act on over-limit approval requests

/** Every permission, in a stable order — the owner's full grant. */
export const ALL_PERMISSIONS: Permission[] = [
  "counter",
  "activity",
  "approvals",
  "parties",
  "purchases",
  "sales",
  "inventory",
  "payments",
  "gst",
  "reports",
  "catalogue",
  "salesmen",
  "imports",
  "settings",
  "manage_users",
  "approve_discounts",
];

/**
 * Base capabilities per role. Per-user grants/revocations (the
 * `membership_permissions` table) are layered on at runtime by
 * {@link effectivePermissions}; these are the defaults a new member starts with.
 *
 *  - **owner**       — everything (the org account holder).
 *  - **manager**     — everything *except* user administration (`manage_users`).
 *  - **pharmacist**  — dispensing + stock: counter, inventory, catalogue, goods receipt.
 *  - **cashier**     — the counter and its supporting feed/approvals only.
 *  - **accountant**  — the books: parties, payments, GST, reports, sales/purchase docs.
 *
 * owner→owner and cashier→cashier map cleanly from the old two-role model, so the
 * 0043 migration causes no lockouts (a pre-migration cashier sees exactly what it
 * saw before: counter / activity / approvals).
 */
export const ROLE_CAPABILITIES: Record<UserRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => p !== "manage_users"),
  pharmacist: ["counter", "activity", "approvals", "purchases", "inventory", "catalogue"],
  cashier: ["counter", "activity", "approvals"],
  accountant: ["activity", "parties", "purchases", "sales", "payments", "gst", "reports", "salesmen"],
};

/** A per-user override row (from `membership_permissions`): grant or revoke one permission. */
export interface PermissionOverride {
  permission: Permission;
  granted: boolean;
}

/**
 * The effective permission set for a member: the role's base capabilities with
 * per-user overrides applied (a `granted` row adds, a revoked row removes).
 */
export function effectivePermissions(
  role: UserRole | null | undefined,
  overrides: readonly PermissionOverride[] = [],
): Set<Permission> {
  const set = new Set<Permission>(role ? ROLE_CAPABILITIES[role] : []);
  for (const o of overrides) {
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

/** The roles whose *base* capabilities include `permission` — used to seed nav role-gating. */
export function rolesWith(permission: Permission): UserRole[] {
  return USER_ROLES.filter((r) => ROLE_CAPABILITIES[r].includes(permission));
}
