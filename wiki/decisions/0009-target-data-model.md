---
type: decision
updated: 2026-05-30
tags: [data-model, schema, multi-shop, accounting, gst]
---

# 0009 — Target data model: design the whole IA before building further

## Status
Accepted (design only). Draft SQL lives in `supabase/proposed/0014–0024` — **not applied**. Promoted into `supabase/migrations/` slice by slice as each module is built.

## Context
The navigation shell ([information-architecture](../architecture/information-architecture.md)) exposes 10 modules / ~35 sub-modules, but only 4 had backing schema (auth/org, items/batches, ledgers, the unified `orders` table). Purchases, Payments, Returns, GST, Reports, Catalogue, inventory movements, multi-shop, and drug licenses had none. Purchases/Payments/Returns/GST all touch the same money + stock + ledger core — built piecemeal, that core would be rewritten repeatedly. So we designed the full model in one pass first.

## Decision
Five forks, chosen with the user:
1. **Scope** — full IA + forward hooks for Tier-4 (multi-store, OCR, ABHA, ONDC).
2. **Multi-shop now** — an org is the firm; `shops` sit under it; stock/documents carry `shop_id`. RLS stays org-level (`is_member`); per-shop cashier access is a hook (`shop_members`).
3. **Per-document-type tables on a shared backbone** — dedicated tables per doc type (sales_invoices, purchases/GRN, POs, credit/debit notes, payments), all posting to two shared ledgers.
4. **Double-entry + light chart of accounts** — every document posts balanced `ledger_entries` against a seeded `chart_accounts`. Party balance, trial balance, P&L, balance sheet, and GST all derive by `SUM()`.
5. **Deliverable: draft SQL (unrun)** in `supabase/proposed/`.

## The two backbones (the crux)
- **`stock_movements`** — immutable signed inventory ledger; `batches.qty` becomes a cache the document RPCs keep in step (replaces the inline stock mutation buried in `place_order`).
- **`chart_accounts` + `ledger_entries`** — double-entry posting layer; opening balances post against Opening Balance Equity.

## Consequences
- `orders`/`place_order` is retired: sales → `create_sales_invoice`, purchases → `receive_purchase`. App billing/history/purchase paths re-point to the new RPCs at cutover (not in this pass).
- GST split (CGST+SGST intra vs IGST inter) becomes authoritative in the RPCs (`shops.state_code` vs `ledgers.state_code`).
- **`merge_ledgers` (migration 0009) must be extended** to re-point `ledger_entries`/`purchases`/`payments` before deleting a merged party — those FKs are RESTRICT by design.
- Schedule H1/X gets a real register + `enforce_h1_gate`; wiring it into `create_sales_invoice` is a 1-line add at build time.
- Historical stock/ledgers are seeded as opening movements + balanced opening entries at cutover.

## Verification
All 24 files (0001–0013 real + 0014–0024 proposed) applied cleanly into an in-process Postgres (PGlite): 55 tables (every one with RLS), 15 views, 21 functions. Posting smoke test (purchase 10 → sale 5 → sale-return 2 → vendor-return 1 → vendor payment): stock on-hand = 6 across `batches`, `stock_movements`, and `v_stock_on_hand`; trial balance nets to **0** (raw ledger and `v_trial_balance`).

## Links
- Index of the draft files → [../architecture/proposed-data-model](../architecture/proposed-data-model.md)
- As-built model → [../architecture/data-model](../architecture/data-model.md) · [../architecture/schema](../architecture/schema.md)
- Module map → [../product/product-modules](../product/product-modules.md)
