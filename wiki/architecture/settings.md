---
type: architecture
updated: 2026-06-02
tags: [settings, rbac, config, compliance, admin]
---

# Settings module

The owner's **configuration + administration** surface: shop identity, team roles, compliance records, data portability, and policy knobs. Everything lives under `/settings/*` (plus the legacy `/owner`), is **owner-gated**, and is reached from the Settings group in the sidebar. Screens are deliberately low-frequency and form-based — built on the shared design-system patterns ([design-system](design-system.md)), not bespoke.

Backs the IA's Settings node — see [information-architecture](information-architecture.md) §Settings. Files: `apps/web/src/components/settings/` + a few `apps/web/src/lib/` helpers.

## Screens (as-built)

| Screen | Route | What | Key file | Ticket |
|---|---|---|---|---|
| Organisation | `/settings/organisation` | Edit the active shop's tax identity (name, state, GSTIN, address, UPI, cutover) — drives the GST split | `OrgSettingsPage.tsx` | (pre-existing; restyled SALT-224) |
| Shops | `/settings/shops` | List/add/edit every shop; **Make primary** switches the active shop org-wide | `ShopsManagerPage.tsx` | SALT-090 |
| Roles & permissions | `/settings/users` | List members, assign one of 5 roles, fine-tune per-user module access | `UsersRolesPage.tsx` | SALT-091 |
| Drug licenses | `/settings/licenses` | D&C licenses with 90/60/30-day renewal alerts | `DrugLicensesPage.tsx` + `lib/licenses.ts` | SALT-088 |
| Print templates | `/settings/print` | Author the default invoice template (paper/header/footer/copies) with live preview | `PrintTemplatesPage.tsx` + `lib/printTemplate.ts` | SALT-089, SALT-197 |
| Audit log | `/settings/audit` | Read-only, UI-immutable change trail with before/after JSON | `AuditLogPage.tsx` | SALT-092 |
| Data export | `/settings/export` | Per-dataset CSV + a full JSON backup of the org's data | `DataExportPage.tsx` + `lib/exportData.ts` | SALT-093 |
| Data privacy | `/settings/privacy` | DPDP right-to-access (export) + right-to-erasure (anonymise) for a party | `PartyPrivacyPage.tsx` | SALT-194 |
| Discount limits | `/settings/limits` | Org discount policy (`discount_max_pct` + ₹ cap) — enforced at checkout via approvals | `DiscountLimitsPage.tsx` | SALT-016 |
| Users & invites | `/owner` | Cashier-invite codes (the original owner screen) | `components/owner/OwnerHome.tsx` | (pre-existing) |

## Data model, RPCs & migrations

Most backing tables were **already live** (the proposed `0022_gst_compliance` / `0024_settings` slices — see the gotcha below), so most screens were frontend-only. Tables used: `shops`, `drug_licenses`, `print_templates`, `org_settings` (jsonb blob — discount limits live here), `audit_log`, `memberships`, and the export-source tables.

User-run migrations this module added (run in the Supabase SQL editor):

| Migration | Adds | Powers |
|---|---|---|
| `0041_party_pii.sql` | `export_party_pii(p_party_id)` → jsonb bundle; `erase_party_pii(p_party_id)` → anonymise, keep postings, write `audit_log` | Data privacy (SALT-194) |
| `0048_roles_permissions.sql` | `user_role` enum widened to 5; `memberships.permissions jsonb`; owner-only `org_members()`, `set_member_role()`, `is_org_owner()` | Roles & permissions (SALT-091) |
| `0055_fix_org_members_ambiguous.sql` | `create or replace org_members()` — qualifies `memberships.user_id` | Hotfix for the ambiguity bug below |

See [data-model](data-model.md) and [security-rls](security-rls.md) for the broader schema/RLS.

## Decisions & gotchas

- **RBAC is app-layer; RLS hardening is deferred.** `lib/permissions.ts` is the single source of truth — a role→module **capability matrix** + `can(role, overrides, module)` (revoke > grant > role default; `counter` is *always* allowed so the redirect target is reachable). `ProtectedRoute` gates **centrally** by mapping the route path → module → `can()` (so the 60 legacy `allowedRoles` props became no-ops, no per-route edits); `navConfig` visibility derives from the same `rolesForModule`. Owner has every module, so existing owner/cashier behaviour is unchanged. Server-side **role-aware RLS** (defence in depth) is **planned** — SALT-174; today's posture is app-layer gating on top of org-level `is_member` RLS, same as before.
- **Member listing needs a security-definer RPC.** `memberships` SELECT is self-only (0002), so `org_members()`/`set_member_role()` are `security definer` with an explicit owner check (`is_org_owner`) rather than opening RLS on `memberships`/`profiles`. `set_member_role` enforces the **last-owner guard** server-side.
- **`org_members` ambiguity bug.** `RETURNS TABLE (user_id …)` put an OUT param named `user_id` in scope, making the unqualified `where user_id = auth.uid()` ambiguous → the screen errored *"column reference user_id is ambiguous"*. Fixed by aliasing the table + qualifying the column (`0055`). Lesson: in PL/pgSQL `RETURNS TABLE` functions, **always table-qualify columns** that share a name with an OUT param.
- **Migrations are user-run; frontends degrade gracefully.** Screens ship ahead of the SQL: `auth.tsx` loads `memberships.permissions` with a fallback select, and the roles/PII screens show a "run migration NNNN" hint instead of a raw error. After merging a settings PR, the owner must still run any new migration (`0041`, `0048`, `0055`).
- **The proposed schema is already live.** The "DRAFT / DO NOT RUN" `0014–0024` settings/compliance tables (`drug_licenses`, `print_templates`, `org_settings`, `shop_settings`, `audit_log`, `salesmen`, `invoice_series`) are in fact **applied** — probe the live DB (PostgREST) before writing a migration; don't trust `data-model.md`'s 0001–0013 view.
- **Money is integer paise.** `discount_max_paise` (and all `*_paise`) are integers; the UI converts ₹↔paise.
- **Print template ≠ printed bill (yet).** The settings-authored DB template (`print_templates`, `lib/printTemplate.ts`) and the localStorage `PrintTemplate` the print popup uses (SALT-095) are different shapes/stores that **don't connect** — so saving a template here doesn't change printed bills until **SALT-165** reconciles them. `PrintTemplatesPage` does call `invalidateInvoiceConfig()` on save (SALT-197) so the print-config cache is busted.
- **Switching shops = `is_primary`.** The app operates as the `is_primary` shop, so "Make primary" is functional shop-switching; the persistent header quick-switcher shipped separately (SALT-173).

## Current state vs planned

**Built (all merged):** the 10 screens above. RBAC model + management UI; per-shop config + switching; compliance records (licenses, audit viewer); data portability (export, DPDP erase); discount policy.

**Planned (filed for the owning lanes):**
- **SALT-174** [database] — role-aware RLS hardening (the server-side half of SALT-091).
- **SALT-171** [database] — audit-log capture triggers + DB-level append-only lockdown (the viewer is read-only today; nothing writes yet).
- **SALT-165** [print] — make the print path consume the org's default `print_templates` row.

## Related
[information-architecture](information-architecture.md) · [security-rls](security-rls.md) · [data-model](data-model.md) · [design-system](design-system.md) · decisions [0003 money-as-paise](../decisions/0003-money-as-paise.md), [0004 strict RLS isolation](../decisions/0004-strict-rls-isolation.md)
