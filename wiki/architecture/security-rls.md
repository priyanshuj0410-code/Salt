---
type: architecture
updated: 2026-05-29
---

# Security & RLS

Tenancy and authorization are enforced **in the database**, not just the UI — the React client talks to Postgres directly via PostgREST, so RLS is the real security boundary.

## Model

- **Auth:** Supabase Auth (GoTrue). Email/password + Google OAuth. The user logs in; the client holds a JWT.
- **Tenancy:** every business row has `org_id`. A user's orgs are defined by `memberships(user_id, org_id, role)`.
- **`is_member(org_id) → bool`** (migration 0002): returns true if the current `auth.uid()` has a membership in that org. This function backs every policy.
- **Deny-by-default RLS:** every table has RLS enabled with four policies (select/insert/update/delete) each gated on `is_member(org_id)`. A user can only ever read or write rows in an org they belong to. Cross-org access is impossible through the API regardless of client bugs.
- **Roles:** `owner` | `cashier` (membership role). The UI gates routes via `ProtectedRoute allowedRoles={[...]}` (owner-only: `/owner`, `/parties`, `/import*`). Note: role-gating of *routes* is UI-level; row access is org-level via RLS. Fine-grained per-role row permissions (PRD FR-U-012) are not yet enforced in the DB.

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

PRD §5.4 wants role-based access at the API layer (have it via RLS), MFA for owners (not built), at-rest encryption (Supabase-managed), and append-only audit log (not built). Data residency (India region) depends on the Supabase project region.

## Related
[data-model.md](data-model.md) · [decisions/0004-strict-rls-isolation.md](../decisions/0004-strict-rls-isolation.md)
