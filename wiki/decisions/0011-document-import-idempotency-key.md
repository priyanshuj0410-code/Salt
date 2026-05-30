---
type: decision
updated: 2026-05-31
---

# 0011 — Document import idempotency key

**Status:** accepted (design; pre-implementation) · **Date:** 2026-05-31

## Context

Extending Smart Import to ingest Marg **registers** (sales, purchases/GRN, returns, receipts/payments, transfers, journals) means inserting up to lakhs of document rows. Bulk imports get re-run — partial failures, corrections, a fresh export. Without a natural key, a re-run **double-inserts documents**, which (once they post effects) means double stock movements and double ledger entries → corrupted on-hand and balances.

Masters already avoid this: `items` upsert on `(org_id, item_code)`; parties upsert on `(org_id, gstin)` ([0010](0010-gstin-canonical-party-identity.md)). Documents have **no** stable Salt-side natural key — and Salt generates its *own* numbers via `invoice_series`, so the original **Marg** document number must be preserved separately from Salt's.

## Decision

Add provenance + a dedup key to every importable **document header** table — `sales_invoices`, `purchases`, `credit_notes`, `debit_notes`, `payments`, `stock_transfers`, `journal_vouchers`:

- `source_system text` (e.g. `'marg'`) and `source_doc_no text` (the original Marg bill/voucher number).
- Partial unique index per table: `(org_id, shop_id, source_system, source_doc_no) where source_doc_no is not null`.
- The importer **upserts on this key** → re-import is idempotent (skip or update, never duplicate).
- **Distinct from Salt numbering:** `source_doc_no` = Marg origin (provenance + dedup); `invoice_no` / `next_doc_no` = Salt's own series. They may coincide on import or diverge.
- **Lines** are not keyed individually — they dedup via their parent (re-import replaces a document's lines atomically in the cascade).
- **Default mode is insert-or-skip:** if the key already exists, skip. An explicit "re-import / overwrite" is a separate, guarded path that must first **reverse** the document's prior `stock_movements` / `ledger_entries` before re-posting (or refuse if the doc was touched post-import). This keeps the shared backbone consistent.
- Faithful capture is unchanged — the full source row still lands in `source` jsonb.

## Consequences

- **(+)** Safe, resumable bulk import; no double stock or double accounting on re-run.
- **(+)** Full provenance — every imported document traces to its Marg origin; enables reconciliation against the source by doc number.
- **(+)** Composes with [0010](0010-gstin-canonical-party-identity.md) (party upsert) and [0012](0012-stock-cutover-snapshot-vs-replay.md) (pre-cutover docs don't post effects).
- **(−)** Schema change: a column pair + partial unique index across ~7 tables (one migration).
- **(−)** The "overwrite" path needs transactional reversal of prior effects — non-trivial; hence insert-or-skip is the default.
- **(−)** Marg documents with no number (rare) fall back to insert-only (no dedup) — acceptable.

**Implementation note (pre-built):** to be delivered as a migration when the importer extension is built (run by the user).

See [0010](0010-gstin-canonical-party-identity.md) · [0012](0012-stock-cutover-snapshot-vs-replay.md) · [architecture/marg-import-map](../architecture/marg-import-map.md) · [architecture/proposed-data-model](../architecture/proposed-data-model.md)
