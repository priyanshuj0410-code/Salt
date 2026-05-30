---
type: decision
updated: 2026-05-31
---

# 0012 — Stock cutover: snapshot, not replay

**Status:** accepted (design; pre-implementation) · **Date:** 2026-05-31

## Context

There are two ways to establish on-hand stock from Marg:

1. **Snapshot** — import the current **batch-wise closing-stock** report as opening balances.
2. **Replay** — import every historical purchase/sale/return/adjustment and let on-hand be *derived* by the `stock_movements` ledger (`batches.qty` is its cache).

Doing **both** double-counts. And we *will* import historical documents regardless — they're needed for reports, GST registers, party statements, and batch/cost provenance. So the real question is: **what is authoritative for on-hand at onboarding?**

Replaying years of movements to land exactly on today's figure requires the history to be complete and perfectly consistent — which it rarely is (manual edits, breakage handled outside the system, pre-system opening stock). A physical-shelf **snapshot** is the number the shopkeeper actually trusts.

## Decision

**The closing-stock snapshot at a cutover date is authoritative for on-hand.**

- Import batch-wise closing stock as **`opening` `stock_movements`** (one per batch), dated at the shop's `cutover_date`. On-hand then *exactly* matches Marg's closing figures.
- **Historical documents before the cutover are imported as records only — they do NOT post stock.** No `stock_movements` for pre-cutover lines. They exist for reporting, GST history, party ledgers, and batch/cost provenance.
- **Only documents after the cutover move stock** (normal operation).
- **Accounting mirrors this:** the trial balance (opening balances) is authoritative for party/GL balances at cutover; pre-cutover documents do **not** post `ledger_entries` (their financial effect is already in the opening balances). Same principle, applied to money.
- Mechanism: a per-shop `cutover_date` + a per-document "imported / does-not-post" flag so the posting RPCs skip inventory/accounting side effects for pre-cutover rows. Ties into the idempotency key in [0011](0011-document-import-idempotency-key.md).

## Consequences

- **(+)** On-hand and balances match Marg's closing figures exactly at cutover — no drift, no reconciliation pain.
- **(+)** Still get full historical sales/purchase records, GST registers, batch provenance, and party statements.
- **(+)** Simpler, faster importer: pre-cutover docs are pure inserts (with [0011](0011-document-import-idempotency-key.md)'s key); no running-stock recomputation.
- **(−)** Pre-cutover documents are effectively **read-only** records — editing one won't retro-adjust stock/balances (correct, but must be clear in the UI).
- **(−)** No per-batch movement *audit* before the cutover (only the opening snapshot) — Marg remains the system of record for pre-cutover audit.
- **(−)** Adds a `cutover_date` concept + a per-document non-posting flag (small model addition, alongside [0011](0011-document-import-idempotency-key.md)).

**Alternative rejected — full replay:** too fragile (history rarely reconciles to the unit/paise), heavier to import, and yields an on-hand the shopkeeper may not trust.

See [0011](0011-document-import-idempotency-key.md) · [0010](0010-gstin-canonical-party-identity.md) · [architecture/marg-import-map](../architecture/marg-import-map.md) · [architecture/proposed-data-model](../architecture/proposed-data-model.md) · [domain/medical-retail](../domain/medical-retail.md)
