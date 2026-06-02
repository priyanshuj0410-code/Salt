---
type: architecture
updated: 2026-06-02
tags: [database, migrations, rpcs, rls]
---

# Database module

The **database module** owns `supabase/migrations/` — the schema, the security-definer
**RPCs** that are the write path for billing / GST / returns / payments / inventory, and the
RLS that enforces tenancy + role. It is the **upstream producer** every feature lane consumes:
lanes file tickets here for a column or RPC, and build their UI once it lands.

For the table/column reference see [schema.md](schema.md); for the narrative model + the
`0014–0024` backbone see [data-model.md](data-model.md); for tenancy/role see
[security-rls.md](security-rls.md). This page covers the **operational RPC layer + migrations
`0032`+** (built on top of that backbone).

## Conventions (non-negotiable)
- **Money is integer paise** everywhere; per-unit prices `integer`, running totals `bigint`.
- **Every business table** carries `org_id` + deny-by-default RLS gated on `is_member(org_id)` (and, since `0044`, role on the sensitive ones).
- **RPCs are `security definer set search_path = public`** and resolve the caller's org from `memberships` (or take it explicitly + `is_member`-check when there is no JWT — the Razorpay webhook).
- **Migrations are user-run** in the Supabase SQL editor — never auto-applied. Number against the **true `origin/main` max** (`git ls-tree origin/main`), not the lane base — parallel lanes interleave numbers (multiple files share a prefix with distinct suffixes).
- **Proposed-is-as-built:** the `0014–0024` "DRAFT / DO NOT RUN" files in `supabase/proposed/` were applied to the live DB, then promoted into `supabase/migrations/` (SALT-140). Always probe the live objects before "creating" — `invoice_series`, `credit_notes`, `h1_register`, `audit_log`, `next_doc_no` all already existed. See [decisions/0009](../decisions/0009-target-data-model.md).

## `create_sales_invoice` — the cumulative chain
The billing write path is a **single RPC evolved by a chain of `create or replace` migrations**.
Each fully replaces the function, so **every new migration carries forward all prior logic** or
it silently drops a feature. Adding a parameter changes the signature → `drop function` the exact
prior signature first (else PostgREST sees a stale overload and 404s); adding a *per-line* field
rides inside the `p_lines` jsonb and needs **no** signature change.

| Migration | Adds | Signature |
|---|---|---|
| `0032_h1_enforcement` | Schedule **H1/X gate**: writes an `h1_register` row per H1/X line + `enforce_h1_gate` rolls back an incomplete Rx (SALT-148) | +`p_doctor_*`/`p_patient_*` |
| `0033_invoice_series` | gap-free **FY-scoped `invoice_no`** via `next_doc_no` (SALT-013/176) | +`p_series_id` |
| `0034_sale_tenders` | **split-tender** payment (`sale_tenders`) (SALT-011) | +`p_tenders` |
| `0045_idempotency_keys` | optional `p_idempotency_key` → safe offline replay (SALT-201) | +`p_idempotency_key` |
| `0050_…_salesman` | stamps `sales_invoices.salesman_id` (SALT-218) | +`p_salesman_id` |
| `0057_fractional_stock` | **loose-unit** decrement in base units (SALT-233) | per-line `loose_units` (no sig change) |

Current signature is 15 args. It is the GST authority (CGST+SGST vs IGST from shop-vs-party
state), backs MRP-inclusive tax out of each line, moves stock, and posts balanced double entries.

## RPC catalogue (this module owns the write path)
- **Sales:** `create_sales_invoice` (above); `create_credit_note` (sales return: restock + reverse entries + refund mode; **over-return guard** vs sold−already-returned, SALT-015).
- **Purchase:** `receive_purchase` (GRN: stock in, ITC, scheme/free goods); `create_debit_note` (vendor return). Both **owner-gated** (`0046`, SALT-208).
- **Payments:** `record_payment` (+`p_salesman_id` `0043`; +`p_idempotency_key` `0045`); `record_gateway_payment` (service-role-only, idempotent on the Razorpay id, `0042`).
- **Numbering:** `next_doc_no(shop, doc_type, code='DEFAULT')` — gap-free, FY-scoped, carries prefix/width forward; `current_indian_fy()`.
- **Pricing:** `resolve_price(party, item, shop?, mrp?, cost?)` → `{price_paise, rule_id, rule_label}`, pure resolver over `price_rules`, MRP fallback (SALT-010).
- **Credit:** `party_credit(org, party)` → `{credit_limit_paise, due_paise}` — server-side dues so the cashier credit check needs no direct financial-table reads (SALT-213).
- **Held bills:** `hold_bill` / `resume_bill` (atomic claim: returns snapshot **and** deletes) / `discard_held_bill` (SALT-159).
- **GDPR/DPDP:** `export_party_pii` (machine-readable bundle) / `erase_party_pii` (anonymise PII, **keep postings**; suppresses its own audit-PII leak) (SALT-188).
- **Helpers:** `has_role(org, role)` / `has_any_role(org, roles[])` — back the role-aware policies.

## Cross-cutting capabilities shipped
- **Role-aware RLS** (`0044`, SALT-199, FR-U-012): `has_role` + owner-only gating on purchasing/payments/GST/accounting (all ops) and masters/config (writes); the sales path stays `is_member`. Financial-read tightening on `payments`/`sales_invoices` to *financial-role-or-own-rows* in `0048` (SALT-213). Owner-only **definer RPCs** also check `has_role` (`0046`). Full matrix in [security-rls.md](security-rls.md).
- **Audit log** (`0038`, SALT-171): a reusable `AFTER INSERT/UPDATE/DELETE` trigger (`audit_capture`) on the high-value tables + DB-level append-only lockdown (drop UPDATE/DELETE policies, revoke grants). `0041` taught it a txn-local suppress switch so erasure does not leak PII into `audit_log.before`.
- **Idempotency** (`0045`, SALT-201): `idempotency_keys` + an optional `p_idempotency_key` on the four write RPCs — a replay returns the original document id, never re-posts. Phase 1 of the offline substrate.
- **Fractional stock** (`0057`, SALT-233): `items.units_per_pack` + `batches.loose_units` + base-unit decrement — see [decisions/0018](../decisions/0018-fractional-stock-loose-units.md).
- **Razorpay** (`0042` + `supabase/functions/razorpay-paylink` & `razorpay-webhook`, SALT-169): Salt's first edge functions; webhook verifies the HMAC and calls `record_gateway_payment` via the service role.
- **Ledger fields:** `customer_group` (segmentation) + `clinical` jsonb (chronic/allergy/meds PII) on `ledgers`.

## Gotchas worth knowing
- **Cumulative RPC chain** (above) — the single biggest footgun; carry the whole body forward.
- **Signature-change hazard:** when an RPC gains a param, billing must send it only after the migration is applied (or omit it) — else a PostgREST signature 404. Coordinated via tickets (SALT-185/187/195/218).
- **Sequencing landmine:** `0048_restrict_financial_reads` must run **only after** billing switched the credit check to `party_credit` (SALT-214) — else the cashier credit warning undercounts. It is the one migration with an explicit "run after" caveat.
- **No local Postgres** in this lane: migrations are validated **structurally** (`$$`/paren/`if`-`end if`/loop balance, signature arity) + by **diffing** cumulative RPC bodies against the prior version to prove only the intended lines changed.

## Current state vs planned
Built: H1/X enforcement, FY invoice series, split tenders, sales-return guard, audit capture +
lockdown, pricing rules, held bills, party PII export/erase, Razorpay capture, role-aware RLS +
financial-read restriction + RPC guards, idempotency keys, salesman attribution, fractional stock.
Planned/handed off: gate the remaining definer RPCs as new roles (`manager`/`accountant`) land;
the offline **write-queue** (SALT-200) consuming `0045`'s keys; loose-unit **purchase**/GRN.

## Related
[schema.md](schema.md) · [data-model.md](data-model.md) · [security-rls.md](security-rls.md) · [decisions/0003 (paise)](../decisions/0003-money-as-paise.md) · [decisions/0004 (RLS)](../decisions/0004-strict-rls-isolation.md) · [decisions/0018 (fractional stock)](../decisions/0018-fractional-stock-loose-units.md)
