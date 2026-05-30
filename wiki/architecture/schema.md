---
type: architecture
updated: 2026-05-29
tags: [schema, database, reference]
---

# Schema reference

Exact table + column definitions for the Postgres (Supabase) database, as built by migrations `0001`–`0012`. For the narrative model, RPCs, and what's *not* yet modeled, see [data-model.md](data-model.md); for the isolation rules see [security-rls.md](security-rls.md).

## Conventions

- **Primary keys** are `uuid default gen_random_uuid()` (except `profiles.id`, which **is** the `auth.users.id`).
- **Tenancy:** every business table carries `org_id uuid not null references orgs(id) on delete cascade`.
- **RLS:** business tables are deny-by-default with four policies (select/insert/update/delete), each gated on `public.is_member(org_id)`. Exceptions (`profiles`, `orgs`, `memberships`, `invites`, `migration_tokens`, `known_vendors`) are noted per table.
- **Money** is integer **paise**. Per-unit prices use `integer`; running totals/balances that can grow large use `bigint`.
- **`created_at timestamptz not null default now()`** is on every table (omitted from the column lists below for brevity).
- **Expiry** is stored as a `text` string (`YYYY-MM`); transactional dates (`bill_date`, `order_date`, `due_date`) are real `date`s.

## Relationships at a glance

```
auth.users ──1:1── profiles
auth.users ──┐
             ├──< memberships >── orgs ──< (every business table via org_id)
orgs ────────┘
orgs ──< items ──< batches
items ──(item_code, unique per org)
orgs ──< ledgers ──< ledger_bills
ledgers ──0..1── orders >── order_lines >── items
orgs ──< orders          (party_id → ledgers, null = walk-in)
orgs ──< invites, migration_tokens
known_vendors            (global reference, no org_id)
```

## Enums

| Type | Values |
|---|---|
| `user_role` | `cashier`, `owner` |

---

## profiles  ·  migration 0001

One row per authenticated user, auto-created by the `handle_new_user` trigger on `auth.users` insert.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | — | PK; FK → `auth.users(id)` cascade |
| email | text | yes | — | copied from auth at signup |
| full_name | text | yes | — | from `raw_user_meta_data.full_name` |
| role | user_role | no | `cashier` | legacy per-user role; the **authoritative** role lives on `memberships` |

RLS: `select` own row only (`auth.uid() = id`).

## orgs  ·  migration 0002 (+0012)

A customer organization (one or more shops; multi-shop not yet modeled).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| name | text | no | — | |
| created_by | uuid | yes | — | FK → `auth.users(id)` |
| state_code | text | yes | — | **(0012)** shop's home state — GST place-of-supply |

RLS: members read their orgs (`is_member(id)`). Created via `create_org(name)` (also inserts the owner membership).

## memberships  ·  migration 0002

Ties an auth user to an org with a role. The one-org-per-user guard is migration 0003.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| user_id | uuid | no | — | FK → `auth.users(id)` cascade |
| role | user_role | no | `cashier` | **authoritative** app role (`owner` \| `cashier`) |

Constraint: `unique (org_id, user_id)`. RLS: read own memberships (`user_id = auth.uid()`). `is_member(org_id)` is a security-definer helper over this table.

## items  ·  migration 0004 (+0012)

Product master.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| name | text | no | — | |
| salt | text | yes | — | active molecule |
| manufacturer | text | yes | — | |
| pack | text | yes | — | e.g. `10S`, `30ML` |
| hsn | text | yes | — | HSN tax code |
| gst_rate | numeric | no | 0 | GST percent (0/5/12/18) |
| schedule | text | no | `OTC` | check ∈ `OTC, H, H1, X` |
| barcode | text | yes | — | |
| item_code | text | yes | — | **(0012)** per-shop SKU; unique per org via `items_org_code_idx` (non-partial, so it can be the upsert `ON CONFLICT` target; NULL codes allowed) |
| source | jsonb | no | `{}` | **(0013)** verbatim import row — every source column, even unmapped ones |

Indexes: `items_org_idx`. RLS: standard four. Stock is **not** here — it lives on `batches`.

## batches  ·  migration 0004

Per-item stock. One row per physical batch; opening-stock imports create one synthetic batch per item (`batch_no`/`expiry` null).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| item_id | uuid | no | — | FK → `items(id)` cascade |
| batch_no | text | yes | — | |
| expiry | text | yes | — | `YYYY-MM` string; null sorts first in FEFO |
| qty | integer | no | 0 | units on hand |
| mrp_paise | integer | no | 0 | MRP per pack (GST-inclusive) |
| ptr_paise | integer | no | 0 | price-to-retailer / landed cost |
| source | jsonb | no | `{}` | **(0013)** verbatim import row — e.g. `Cost Price`, `Sales Price`, `Rack No.`, scheme deal/free |

Indexes: `batches_org_idx`, `batches_item_idx`. RLS: standard four.

## ledgers  ·  migration 0007 (+0008, +0012)

Parties — customers, vendors, and control accounts.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| name | text | no | — | |
| type | text | no | `customer` | check ∈ `customer, vendor, other` (0008 migrated old `supplier`/`both`) |
| phone | text | yes | — | |
| gstin | text | yes | — | |
| address | text | yes | — | |
| credit_limit_paise | integer | no | 0 | |
| opening_balance_paise | bigint | no | 0 | **(0008)** signed: **+ = receivable (Dr)**, **− = payable (Cr)** |
| state_code | text | yes | — | **(0012)** party state for intra/inter-state GST |
| source | jsonb | no | `{}` | **(0013)** `{ trial_balance, gst_master }` — verbatim rows from both party files |

Indexes: `ledgers_org_idx`. RLS: standard four. See [domain/parties.md](../domain/parties.md).

## ledger_bills  ·  migration 0008

Per-invoice open items under a ledger, parsed from the trial balance.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| ledger_id | uuid | no | — | FK → `ledgers(id)` cascade |
| ref_no | text | yes | — | invoice/bill reference |
| bill_date | date | yes | — | |
| amount_paise | bigint | no | 0 | |
| nature | text | yes | — | check ∈ `dr, cr` |
| due_date | date | yes | — | |
| days_overdue | integer | yes | — | |

Indexes: `ledger_bills_org_idx`, `ledger_bills_ledger_idx`. RLS: standard four. These are the breakdown of `opening_balance_paise` → [domain/trial-balance.md](../domain/trial-balance.md).

## known_vendors  ·  migration 0008

Global reference list (~70 seeded pharma companies) used by `classify_parties`. **No `org_id`** — shared across all orgs.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| name | text | no | — | canonical company name |
| norm | text | no | — | normalized (lowercase, alnum) for substring matching |
| source | text | yes | `seed` | provenance |

RLS: read-only for any authenticated user; no insert/update policy (writes via service role).

## orders  ·  migration 0010

Unified sales + purchases. A sale is a "bill".

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| party_id | uuid | yes | — | FK → `ledgers(id)` **set null**; **null = walk-in** |
| direction | text | no | — | check ∈ `sale, purchase` |
| order_no | text | yes | — | invoice/order reference |
| order_date | date | no | current_date | |
| status | text | no | `placed` | |
| payment_method | text | yes | — | `cash` \| `credit` by convention |
| credit_days | integer | yes | — | repayment window |
| due_date | date | yes | — | set when credit |
| total_paise | bigint | no | 0 | server-computed (Σ line totals) |
| paid_paise | bigint | no | 0 | cash ⇒ = total; credit ⇒ 0 |
| notes | text | yes | — | |

Indexes: `orders_org_created_idx (org_id, created_at desc)`, `orders_party_idx`. RLS: standard four. Written via `place_order`. See [domain/orders.md](../domain/orders.md).

## order_lines  ·  migration 0010

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| order_id | uuid | no | — | FK → `orders(id)` cascade |
| item_id | uuid | yes | — | FK → `items(id)` **set null** (ad-hoc lines allowed) |
| name | text | no | — | line description (snapshot) |
| batch_no | text | yes | — | |
| expiry | text | yes | — | |
| qty | integer | no | 0 | |
| rate_paise | bigint | no | 0 | **MRP** for a sale, **PTR** for a purchase |
| discount_type | text | yes | — | `pct` \| `flat` |
| discount_value | numeric | no | 0 | percent or paise |
| gst_rate | numeric | no | 0 | line GST percent |
| line_total_paise | bigint | no | 0 | net after discount (GST-inclusive) |

Indexes: `order_lines_order_idx`, `order_lines_org_idx`. RLS: standard four.

## invites  ·  migration 0006

One-time codes to add cashiers/owners during onboarding.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| code | text | no | — | unique; 8-char uppercase |
| role | user_role | no | `cashier` | role granted on redemption |
| created_by | uuid | yes | — | FK → `auth.users(id)` |
| expires_at | timestamptz | no | now() + 7 days | |
| used_at | timestamptz | yes | — | set on redemption |
| used_by | uuid | yes | — | FK → `auth.users(id)` |

RLS: owners read their org's invites. Created/redeemed via `create_invite` / `redeem_invite`.

## migration_tokens  ·  migration 0005

One-time, org-scoped, expiring tokens the Go migrator redeems to upload items/batches without a user session.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | uuid | no | gen_random_uuid() | PK |
| token | text | no | — | unique; bearer credential |
| org_id | uuid | no | — | FK → `orgs(id)` cascade |
| created_by | uuid | yes | — | FK → `auth.users(id)` |
| expires_at | timestamptz | no | now() + 24 hours | |
| used_at | timestamptz | yes | — | set on redemption |

RLS: owners read their org's tokens. Created via `create_migration_token`; consumed by `redeem_migration_token(token, items_jsonb)`.

---

## Sample-file provenance (the reference Saral export)

Which source file + column fills each Salt column, for the four-file Saral export. The importer **auto-maps** columns (other shops' headers differ) — this shows the shape, verified on the real files. Rupee amounts are ×100 → paise. See [import-pipeline](import-pipeline.md) and [decisions/0008](../decisions/0008-import-join-keys.md).

The four files fill exactly **four tables**: `ledgers`, `ledger_bills`, `items`, `batches`. Everything else (`orders`/`order_lines` from billing, `orgs`/`memberships`/`profiles`/`invites`/`migration_tokens` from onboarding, `known_vendors` from seed) is **not** import-sourced.

> **Nothing is discarded.** The columns below show what fills each *typed* column. **Every** source column — including the ones with no typed home — is also kept verbatim in the entity's `source jsonb` (migration 0013). The "kept only in `source`" lists below are queryable today and can be promoted to typed columns when a feature needs them.

### ledgers ← `Trial_Balance.xls` (spine) + `partygstmaster` (enrichment)

Joined by normalized **name**. Spine creates the row; the GST master fills only null fields.

| Salt column | Source file | Source column / derivation |
|---|---|---|
| name | Trial Balance | party (ledger) row name |
| opening_balance_paise | Trial Balance | signed closing balance (`opening + debit − credit`), ×100 |
| phone | Trial Balance, else master | `Ph.:` sub-line; else `partygstmaster.PHONE` |
| type | — | derived by `classify_parties` RPC (keyword → known-vendor → customer) |
| gstin | partygstmaster | `GST` |
| address | partygstmaster | `ADDRESS` |
| state_code | partygstmaster | `STATECODE` |
| credit_limit_paise | — | not in sample → default `0` |
| source | both files | `{ trial_balance, gst_master }` — verbatim rows |

*Kept only in `source.gst_master`:* `TYPE` (Local/Central), `TIN`, `STATE NAME`, `STATE`, `CODE`, `LEDGER CODE`, `LEDGER TYPE` (REGISTERED/UNREGISTERED), `indexkey`, `verify`, `tempfield` — preserved, not lost. (GST-registration status and party code are natural promotions later.)

### ledger_bills ← `Trial_Balance.xls` (bill sub-rows)

| Salt column | Source column / derivation |
|---|---|
| ledger_id | parent party (client-side UUID, see [0007](../decisions/0007-client-side-uuid-generation.md)) |
| ref_no | bill reference (`S001112`, …) |
| bill_date | bill date |
| amount_paise | bill amount, ×100 |
| nature | `Dr` / `Cr` marker on the bill line |
| due_date | bill due date |
| days_overdue | trailing day count |

### items ← `hsncodemaster`

| Salt column | Source column |
|---|---|
| item_code | `ItemCode` (the alphanumeric SKU — **not** the numeric `ItemID`) |
| name | `Name` |
| salt | `Salt` |
| manufacturer | `Company` |
| hsn | `HSNCode` |
| gst_rate | `IGST` (the combined rate = `SGST + CGST`) |
| schedule | not present → default `OTC` |
| pack, barcode | not present in sample |
| source | the whole `hsncodemaster` row |

*Kept only in `source`:* `ItemID`, `M.R.P.`, `P.Rate`, `Stock` (price/stock come from the stock report instead), `LocalTax/SGST/CGST/CentralTax/OldTax/Tax Diff.`, `HsnName`, `Rate`, `AddLess`, `Category` (empty), `Unit` — preserved, not lost.

### batches ← `stock_81` (joined to `items` by code)

Stock report `Code` → `items.item_code` (verified **7,871/7,871**) resolves `item_id`. One synthetic opening batch per item.

| Salt column | Source column / derivation |
|---|---|
| item_id | resolved: `stock_81.Code` → `items.item_code` |
| qty | `Current Stock` |
| mrp_paise | `M.R.P.`, ×100 |
| ptr_paise | `Purchase Price`, ×100 |
| batch_no | not present → `null` (opening batch) |
| expiry | not present → `null` |
| source | the whole `stock_81` row |

*Kept only in `source`:* `Cost Price`, `Sales Price`, `Rack No.`, `Sales Scheme`/`Purc.Scheme` (deal/free), `Value`, `Unit`, `Company`, `Manufacturer`, `Product Name` — preserved, not lost. (Cost/Sales price, rack and scheme are obvious candidates to promote to typed columns when margin, picking and scheme features land.)

## Related
[architecture/data-model](data-model.md) · [security-rls](security-rls.md) · [import-pipeline](import-pipeline.md) · [decisions/0008](../decisions/0008-import-join-keys.md) · [domain/orders](../domain/orders.md) · [domain/parties](../domain/parties.md)
