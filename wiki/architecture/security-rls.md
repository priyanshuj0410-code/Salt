---
type: architecture
updated: 2026-06-01
---

# Security & RLS

Tenancy and authorization are enforced **in the database**, not just the UI — the React client talks to Postgres directly via PostgREST, so RLS is the real security boundary.

## Model

- **Auth:** Supabase Auth (GoTrue). Email/password + Google OAuth. The user logs in; the client holds a JWT.
- **Tenancy:** every business row has `org_id`. A user's orgs are defined by `memberships(user_id, org_id, role)`.
- **`is_member(org_id) → bool`** (migration 0002): returns true if the current `auth.uid()` has a membership in that org. This function backs every policy.
- **Deny-by-default RLS:** every table has RLS enabled with four policies (select/insert/update/delete) each gated on `is_member(org_id)`. A user can only ever read or write rows in an org they belong to. Cross-org access is impossible through the API regardless of client bugs.
- **Roles:** `owner` | `cashier` (membership role). The UI gates routes via `ProtectedRoute allowedRoles={[...]}` (owner-only: `/owner`, `/parties`, `/import*`). As of migration **0044** per-role row permissions (PRD FR-U-012) are also enforced **in the DB** via `has_role(org_id, role)` — see the matrix below — so a cashier JWT cannot reach owner-only data by calling PostgREST directly.

## Role-aware policies (migration 0044, FR-U-012)

`has_role(org_id, role) → bool` (security definer, `set search_path = public`, mirrors `is_member`, reads the authoritative `memberships.role`) backs per-role gating:

| Class | Tables | `select` | `insert`/`update`/`delete` |
|---|---|---|---|
| **Owner-only (all ops)** | `purchases`, `purchase_lines`, `purchase_orders`, `po_lines`, `payments`, `payment_allocations`, `debit_notes`, `debit_note_lines`, `gst_returns`, `gstr2b_imports`/`_lines`/`_matches`, `journal_vouchers`, `ledger_entries`, `chart_accounts`, `bank_statement_lines`, `cash_drawer`, `vendor_schemes` | `has_role('owner')` | `has_role('owner')` |
| **Owner-only writes** (POS/reports still read) | `ledgers`, `ledger_bills`, `items`, `batches`, `invoice_series`, `price_rules`, `drug_licenses`, `salesmen`, `print_templates`, `org_settings`, `shop_settings`, `doctors`, `item_aliases`, `item_substitutes`, `stock_transfers`/`_lines`, `physical_counts`/`_lines` | `is_member` | `has_role('owner')` |
| **Unchanged `is_member` (POS path)** | `sales_invoices`, `sale_lines`, `sale_tenders`, `h1_register`, `held_bills`, `stock_movements`, `credit_notes`, `credit_note_lines`, `activity_events`, `entity_messages`, `approval_requests` | `is_member` | `is_member` |

- `ledgers` **reads stay `is_member`** so a cashier can pick a customer at billing; only party *management* (writes) is owner-only.
- **Known limitation:** `security definer` write RPCs (`receive_purchase`, `create_debit_note`, import RPCs) bypass RLS, so a cashier could still invoke them. Gating those RPC bodies on `has_role` is a tracked follow-on — 0044 closes the **direct-table** hole (the bulk of FR-U-012).
- `master_items` / `known_vendors` are global (no `org_id`) reference tables and keep their existing read-only policies.

## Security-definer RPCs

Some operations need to bypass RLS deliberately and are written as `security definer` functions with **explicit membership checks inside**:

- `create_org`, `redeem_invite`, `redeem_migration_token` — provisioning paths.
- `classify_parties` — reads the global `known_vendors` table.
- `merge_ledgers` — verifies `is_member(survivor.org_id)` and that all merged rows share that org before mutating.

When adding a security-definer function, always re-check membership and `set search_path = public`.

## Keys & secrets

- Only the **publishable/anon key** ships in the frontend — safe by design; RLS constrains what it can do.
- The **service-role key** and DB password are never in the repo or client. Reference data refreshes (e.g. `known_vendors`) would run via service role out-of-band.

## Gaps vs PRD

PRD §5.4 wants role-based access at the API layer — now enforced both org-level (`is_member`) **and** per-role (`has_role`, migration 0044). MFA for owners (not built), at-rest encryption (Supabase-managed), and an append-only audit log (**built** — `audit_log` capture triggers + DB-level lockdown, migration 0038). Remaining: gate the `security definer` write RPCs on `has_role` (follow-on). Data residency (India region) depends on the Supabase project region.

## Related
[data-model.md](data-model.md) · [decisions/0004-strict-rls-isolation.md](../decisions/0004-strict-rls-isolation.md)
