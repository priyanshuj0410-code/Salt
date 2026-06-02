---
type: architecture
updated: 2026-06-02
tags: [owner, dashboard, drug-licenses, invites, compliance]
---

# Owner module

The **owner dashboard** — the landing screen for the `owner` role at **`/owner`** (lazy-loaded, `ProtectedRoute allowedRoles={["owner"]}`). Scope is the `components/owner/` tree: one dashboard screen that bundles team management, quick nav, and a compliance nudge.

> **"Owner module" ≠ "owner-gated".** Many routes are `allowedRoles={["owner"]}` (Reports, GST, Settings…) but each belongs to its own module. This module is *only* the `/owner` landing.

Per [product-modules](../product/product-modules.md), this is the owner/admin home; the analytics surface its subtitle promises ("reporting and inventory health will live here") is **not built yet** — see [Current state](#current-state-vs-planned).

## What is built

### Owner dashboard — `OwnerHome`
At `/owner`, composed top to bottom:
- **Setup checklist** (`SetupChecklist`, onboarding module) — first-run guidance.
- **Drug-license renewal banner** (SALT-066, below).
- **Quick nav** to [Parties](../domain/parties.md) and Bills.
- **Cashiers** — generate a single-use invite code (`create_invite` RPC) and list/copy existing codes with status (active / used / expired).
- **Go to billing** link.

### Drug-license renewal banner — SALT-066
`LicenseRenewalBanner` surfaces drug licenses expiring within **90 days (or already expired)** on the dashboard, so the owner gets a renewal nudge without opening Settings. Each flagged license shows a status badge on the shared **90 / 60 / 30-day** banding (info → warning → danger); the container tone follows the most urgent band; the list is sorted soonest/expired-first and links to **`/settings/licenses`**. **No dismiss** — it persists until the license is renewed, and renders nothing when nothing is due.

The banding logic lives in **`lib/licenses.ts`** (`licenseStatus` / `daysUntil`), extracted from `DrugLicensesPage` (Settings → Drug licenses, SALT-088) so the banner and the settings page share **one source of truth** rather than duplicating the bands.

### Design-token consistency — SALT-226
`OwnerHome` was migrated off shadcn-alias tokens onto the canonical design-system utilities (`text-muted-foreground` → `text-text-tertiary`, `hover:bg-muted/40` → `hover:bg-surface`). **Zero visual change** — the theme already aliases `--muted-foreground → --text-tertiary` and `--muted → --surface-2` (see [design-system](design-system.md)). No KPI/`StatCard` tiles exist yet to convert (dashboard data was out of scope for that pass).

## Key files

| File | Purpose | Ticket |
|---|---|---|
| `apps/web/src/components/owner/OwnerHome.tsx` | The `/owner` dashboard screen | — / 226 |
| `apps/web/src/components/owner/LicenseRenewalBanner.tsx` | Renewal banner over `drug_licenses` | 066 |
| `apps/web/src/lib/licenses.ts` | Shared 90/60/30 renewal banding (`licenseStatus`/`daysUntil`) | 066 |

## Data model + RPCs

The owner module **owns no tables** — it reads two it does not manage:

- **`invites`** (`0006_invites.sql`) — org-scoped single-use codes (`code` unique, `role` default `cashier`, `expires_at` default +7d, `used_at`/`used_by`). RLS: owners read their org's invites. RPCs: **`create_invite(p_role default 'cashier')`** — owner-only, `security definer`, returns an 8-char code (the Cashiers panel's only write); plus `redeem_invite(p_code)` used during onboarding.
- **`drug_licenses`** (`0022_gst_compliance.sql`, SALT-088) — per-shop D&C licenses (`license_type`, `license_no`, `expiry_date`, `holder_name`, …); per-org RLS via `is_member`; indexed on `(org_id)` and `(expiry_date)`. **Created and managed by the GST/Settings lane**; the owner banner is a read-only consumer. See [gst-returns](gst-returns.md).

SALT-066 / SALT-226 added **no owner-specific migrations or RPCs**.

## Decisions / gotchas

- **One banding source of truth.** `lib/licenses.ts` is shared by the owner banner and Settings → Drug licenses — change the 90/60/30 bands there and both surfaces follow. It is a deliberately shared helper (no module owns it).
- **`drug_licenses` is not owner-owned.** The owner module only *reads* it; the table, its CRUD UI, and the renewal alerts in Settings belong to the GST/Settings lane (SALT-088). A cross-module read, not ownership.
- **The banner has no snooze, by design** — a compliance nudge should not be dismissable; it clears only when the underlying license is renewed.
- **Invites are owner-only at the DB layer.** `create_invite` raises unless `auth.uid()` is an `owner` of an org, so the panel cannot leak to other roles even if routed there.

## Current state vs planned

| Status | Item |
|---|---|
| **Built** | Owner dashboard (`/owner`) · cashier invites (`create_invite`) · parties/bills quick-nav · drug-license renewal banner (SALT-066) · canonical design tokens (SALT-226) |
| **Planned** | The KPI/analytics surface the subtitle promises — "reporting and inventory health" — as `StatCard` tiles ([design.md](../../design.md) §6.2), likely fed by the `v_*` report views (see [reports](reports.md)). This is the natural next owner-module ticket. |

## Related
[screens-routing](screens-routing.md) (the `/owner` route + role gating) · [gst-returns](gst-returns.md) (`drug_licenses`, Schedule H1/X) · [design-system](design-system.md) (tokens, `StatCard`) · [reports](reports.md) (the `v_*` views a KPI surface would use) · [security-rls](security-rls.md) (`is_member`, owner RLS) · [data-model](data-model.md) · raw: `salt-prd-v0.3.md`, `design.md` §6.2.
