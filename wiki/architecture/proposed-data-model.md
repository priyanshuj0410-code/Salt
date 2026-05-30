---
type: architecture
updated: 2026-05-30
tags: [data-model, schema, proposed, draft]
---

# Proposed data model (draft SQL, unrun)

A design pass that gives every nav module a clean data model on a shared backbone, **before** building further. Rationale + the five decisions → [../decisions/0009-target-data-model](../decisions/0009-target-data-model.md). For the **applied** schema (migrations 0001–0013) see [data-model](data-model.md) / [schema](schema.md).

**Status:** draft SQL in `supabase/proposed/0014–0024`. Validated end-to-end in PGlite (see the ADR). A one-shot apply script — `supabase/proposed/full_data_model.sql` — concatenates 0014–0024 for pasting into the Supabase SQL editor; it is **additive on top of 0001–0013** (new tables/RPCs/views + safe, idempotent backfills: a primary shop per org, a seeded chart of accounts, opening-balance entries). The app keeps using the existing tables until each module is wired to the new RPCs.

## Conventions (every file)
- `org_id` + deny-by-default RLS via `is_member(org_id)` — the proven gate; `shop_id` added wherever data is shop-local.
- Money in paise; `bigint` for accumulating amounts.
- RPCs are `security definer`, resolve the caller's org from `memberships`, act atomically.
- Views use `security_invoker = true` so per-org RLS still applies.

## The shared backbone
- **`stock_movements`** (0016) — signed inventory ledger; `batches.qty` is its cache.
- **`chart_accounts` + `ledger_entries`** (0017) — double-entry; balances / P&L / balance sheet / GST = `SUM()`.

## Files
| File | Adds |
|---|---|
| `0014_shops` | `shops`, `shop_members`; `shop_id` on batches/orders; `create_org` seeds a primary shop |
| `0015_catalogue` | item columns (unit, reorder, ayush…); `item_aliases`, `item_substitutes`; global `master_items` |
| `0016_inventory_backbone` | `stock_movements`, `stock_transfers(+lines)`, `physical_counts(+lines)`; `batches.expiry_date` |
| `0017_accounting_backbone` | `chart_accounts`(+seed), `ledger_entries`, `journal_vouchers`; helpers `account_id`/`post_entry`; opening-balance backfill |
| `0018_sales` | `sales_invoices`, `sale_lines`; `create_sales_invoice` (GST split + stock + postings) |
| `0019_purchases` | `purchase_orders(+po_lines)`, `purchases`, `purchase_lines`; `receive_purchase` (free goods, ITC) |
| `0020_returns` | `credit_notes`, `debit_notes` (+lines); `create_credit_note`, `create_debit_note` |
| `0021_payments` | `payments`, `payment_allocations`; `record_payment`; `cash_drawer`, `bank_statement_lines` hooks |
| `0022_gst_compliance` | `gst_returns`, `gstr2b_*`, `h1_register`, `drug_licenses`; `record_h1_entry`/`enforce_h1_gate`; GSTR-1/3B/ITC views |
| `0023_reports` | views: on-hand, near-expiry, dead-stock, registers, aging, trial balance, P&L, balance sheet; `audit_log` |
| `0024_settings` | `invoice_series`(+`next_doc_no`), `print_templates`, org/shop settings, `salesmen`; Tier-4 hook stubs |

## Open items for build time
- Retire `orders`/`place_order`; re-point billing / `/bills` history / purchase UI to the new RPCs.
- Extend `merge_ledgers` to re-point `ledger_entries`/`purchases`/`payments` (RESTRICT FKs).
- Wire `enforce_h1_gate` into `create_sales_invoice`; normalize `batches.expiry` → `expiry_date`.
- Seed historical opening movements + balanced opening entries at cutover.
