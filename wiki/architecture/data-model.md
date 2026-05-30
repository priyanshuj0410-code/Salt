---
type: architecture
updated: 2026-05-29
---

# Data model & migrations

All tables live in Postgres (Supabase), every business table carries `org_id` for tenancy, and **every table has deny-by-default RLS** gated on `public.is_member(org_id)` (see [security-rls.md](security-rls.md)). Money is integer **paise**.

Migrations are applied in order by the user in the Supabase SQL editor. For exact column-level definitions (types, nullability, defaults, FKs) see [schema.md](schema.md).

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
| 0010 | `orders` | `orders` + `order_lines` (sales/purchases), `place_order` RPC |
| 0011 | `place_order_purchase` | `place_order` purchase branch — adds stock (upserts batches) |
| 0012 | `import_keys` | `items.item_code` (unique per org), `ledgers.state_code`, `orgs.state_code` |
| 0013 | `source_capture` | `source jsonb` on `ledgers`/`items`/`batches` — verbatim import row, nothing discarded |

## Core entities

**orgs / memberships / profiles** — an `org` is a customer entity (one or more shops; multi-shop not yet modeled). `memberships(user_id, org_id, role)` ties an auth user to an org with role `owner` | `cashier`. `is_member(org_id)` is the RLS workhorse. `create_org` provisions an org + owner membership atomically. (PRD roles are Owner/Manager/Pharmacist/Cashier/Accountant; only owner/cashier exist so far.)

**items** — product master: `name, salt, manufacturer, pack, hsn, gst_rate, schedule (OTC/H/H1/X), barcode`, `org_id`, and (0012) `item_code` — the per-shop Marg/Saral SKU, **unique per org**, the stable key the stock import joins on. **batches** — per-item stock: `item_id, batch_no, expiry, qty, mrp_paise, ptr_paise`. Opening stock imports as one synthetic batch per item (null batch_no/expiry). Billing reads these; the CSV/Smart importers write them. See [import-pipeline.md](import-pipeline.md) and [decisions/0008](../decisions/0008-import-join-keys.md).

**ledgers** (parties) — `id uuid`, `org_id`, `name`, `type ∈ {customer, vendor, other}` (default customer; 0008 migrated the old supplier/both), `phone, gstin, address, credit_limit_paise`, (0008) `opening_balance_paise bigint` — **signed: + = receivable (Dr), − = payable (Cr)**, and (0012) `state_code` (with `orgs.state_code`) for GST place-of-supply (intra- vs inter-state). See [domain/parties.md](../domain/parties.md).

**ledger_bills** — per-invoice open items under a ledger: `ledger_id (FK cascade), ref_no, bill_date, amount_paise, nature ∈ {dr,cr}, due_date, days_overdue`. Parsed from the trial balance → [domain/trial-balance.md](../domain/trial-balance.md).

**known_vendors** — global reference list (~70 seeded pharma companies, `name` + normalized `norm`) used by classification. Readable by any authenticated user; writes only via service role.

**orders / order_lines** (0010) — a unified transaction table for both directions: `direction ∈ {sale, purchase}` (a sale is a "bill"), `party_id` (FK ledgers, **null = walk-in**), `order_date, status, payment_method, credit_days, due_date, total_paise, paid_paise, order_no, notes`. `order_lines` carries `item_id (FK, nullable), name, batch_no, expiry, qty, rate_paise, discount_type, discount_value, gst_rate, line_total_paise`. A party's **amount due** = `opening_balance_paise` + Σ signed unpaid order balances (sale +, purchase −); see [domain/orders.md](../domain/orders.md). Sales are composed on the billing screen (customer-bound) and persisted via `place_order`.

**invites** — one-time codes for adding cashiers. **migration_tokens** — one-time tokens the Go migrator redeems to upload a shop's data.

## Key RPCs

- `create_org(...)` / `redeem_invite(code)` / `create_invite(role)` — onboarding & team.
- `redeem_migration_token(token, payload)` — migrator upload path.
- `classify_parties(names[])` → `(name, type)` — server-side party tagging (keyword control-account → known-vendor → else customer). Security-definer. See [domain/parties.md](../domain/parties.md).
- `merge_ledgers(survivor, merged[])` → int — atomically re-points bills to the survivor, **sums signed opening balances** (net preserved), adopts missing gstin/phone/address, deletes merged rows. Membership-checked. See [decisions/0005-faithful-import-and-merge.md](../decisions/0005-faithful-import-and-merge.md).
- `place_order(direction, party_id, payment_method, credit_days, lines[], order_no?, notes?)` → uuid — atomically inserts an `orders` row + `order_lines`, sets `total_paise`/`paid_paise` (cash ⇒ paid in full; credit ⇒ unpaid + `due_date`), and **moves stock**: a **sale decrements** the matching `(item_id, batch_no)` batch (guards against oversell); a **purchase adds** stock (0011) by upserting the batch (increment qty if it exists, else insert) and refreshing ptr/mrp/expiry. Security-definer, resolves the caller's org from `memberships`. See [domain/orders.md](../domain/orders.md).

## Not yet modeled

Payments ledger (settling beyond `paid_paise`), pricing rules, returns, audit log, multi-shop, and the master drug DB are in the PRD but not in the schema yet. **Sales and purchases now persist and move stock** (0010/0011); per-org invoice numbering is still a simple scheme, and purchases require items already in the catalogue (no new-item creation in the purchase form yet).
