---
type: architecture
updated: 2026-05-29
---

# Data model & migrations

All tables live in Postgres (Supabase), every business table carries `org_id` for tenancy, and **every table has deny-by-default RLS** gated on `public.is_member(org_id)` (see [security-rls.md](security-rls.md)). Money is integer **paise**.

Migrations are applied in order by the user in the Supabase SQL editor.

| # | File | Adds |
|---|------|------|
| 0001 | `profiles` | `profiles` (per auth user) |
| 0002 | `orgs` | `orgs`, `memberships`, `create_org` RPC, `is_member()` |
| 0003 | `one_org_per_user` | guard: a user belongs to one org |
| 0004 | `items` | `items` + `batches` (per-org, RLS) |
| 0005 | `migration_tokens` | `migration_tokens` + `redeem_migration_token` RPC (Go migrator) |
| 0006 | `invites` | `invites` + `create_invite` / `redeem_invite` RPCs |
| 0007 | `ledgers` | `ledgers` (parties) |
| 0008 | `ledger_financials` | `opening_balance_paise`, `ledger_bills`, `known_vendors`, `classify_parties` RPC |
| 0009 | `merge_ledgers` | `merge_ledgers` RPC (party de-duplication) |

## Core entities

**orgs / memberships / profiles** — an `org` is a customer entity (one or more shops; multi-shop not yet modeled). `memberships(user_id, org_id, role)` ties an auth user to an org with role `owner` | `cashier`. `is_member(org_id)` is the RLS workhorse. `create_org` provisions an org + owner membership atomically. (PRD roles are Owner/Manager/Pharmacist/Cashier/Accountant; only owner/cashier exist so far.)

**items** — product master: `name, salt, manufacturer, pack, hsn, gst_rate, schedule (OTC/H/H1/X), barcode`, `org_id`. **batches** — per-item stock: `item_id, batch_no, expiry, qty, mrp_paise, ptr_paise`. Billing reads these; the CSV/Smart importers write them.

**ledgers** (parties) — `id uuid`, `org_id`, `name`, `type ∈ {customer, vendor, other}` (default customer; 0008 migrated the old supplier/both), `phone, gstin, address, credit_limit_paise`, and (0008) `opening_balance_paise bigint` — **signed: + = receivable (Dr), − = payable (Cr)**. See [domain/parties.md](../domain/parties.md).

**ledger_bills** — per-invoice open items under a ledger: `ledger_id (FK cascade), ref_no, bill_date, amount_paise, nature ∈ {dr,cr}, due_date, days_overdue`. Parsed from the trial balance → [domain/trial-balance.md](../domain/trial-balance.md).

**known_vendors** — global reference list (~70 seeded pharma companies, `name` + normalized `norm`) used by classification. Readable by any authenticated user; writes only via service role.

**invites** — one-time codes for adding cashiers. **migration_tokens** — one-time tokens the Go migrator redeems to upload a shop's data.

## Key RPCs

- `create_org(...)` / `redeem_invite(code)` / `create_invite(role)` — onboarding & team.
- `redeem_migration_token(token, payload)` — migrator upload path.
- `classify_parties(names[])` → `(name, type)` — server-side party tagging (keyword control-account → known-vendor → else customer). Security-definer. See [domain/parties.md](../domain/parties.md).
- `merge_ledgers(survivor, merged[])` → int — atomically re-points bills to the survivor, **sums signed opening balances** (net preserved), adopts missing gstin/phone/address, deletes merged rows. Membership-checked. See [decisions/0005-faithful-import-and-merge.md](../decisions/0005-faithful-import-and-merge.md).

## Not yet modeled

Bills/sales, GRN/purchases, payments, pricing rules, audit log, multi-shop, and the master drug DB are all in the PRD but not in the schema yet. Counter billing currently runs on `items`/`batches` without persisting sales.
