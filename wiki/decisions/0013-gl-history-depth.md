---
type: decision
updated: 2026-05-31
---

# 0013 — GL history depth: opening balances only

**Status:** accepted (design; pre-implementation) · **Date:** 2026-05-31

## Context

Salt's accounting is double-entry: `chart_accounts` + `ledger_entries`, with every balance / P&L / balance-sheet / GST figure computed as `SUM()` over `ledger_entries` ([proposed-data-model](../architecture/proposed-data-model.md)). From Marg we can obtain the **trial balance** (opening balances per party/account), the full **day book** (journal + contra vouchers), and every sales/purchase/payment's accounting effect.

[Decision 0012](0012-stock-cutover-snapshot-vs-replay.md) already set the cutover principle for **stock** (snapshot authoritative; pre-cutover documents don't post). The parallel question for **money** is: how deep do we replay the general ledger — and do we import Marg's journal/contra vouchers as postings at all?

## Decision

**Opening balances only, at the cutover — the financial mirror of [0012](0012-stock-cutover-snapshot-vs-replay.md).**

- The **trial balance is authoritative** for party and GL balances at the `cutover_date`; Salt seeds **balanced opening entries** in `ledger_entries` (the model already does this backfill).
- **No full general-ledger replay.** Marg's journal/contra vouchers and pre-cutover document postings are **not** posted to `ledger_entries`. Pre-cutover documents remain records-only ([0012](0012-stock-cutover-snapshot-vs-replay.md)); their financial effect is already captured in the opening balances.
- **Optional period-summary archive.** When a customer wants prior-period comparatives, import Marg's *filed* period summaries (P&L, balance sheet, GST returns) as **read-only snapshots** — jsonb/document rows, **not** replayed postings (`gst_returns.summary` already works this way; a lightweight P&L/BS archive follows the same shape).
- Journal/contra vouchers **after** the cutover are entered and operate in Salt normally.

## Consequences

- **(+)** Simple, fast, and reconciles exactly — balances match Marg at cutover; one cutover principle governs both stock ([0012](0012-stock-cutover-snapshot-vs-replay.md)) and money.
- **(+)** No need for an exhaustive Marg-account/group → `chart_accounts` mapping just to onboard.
- **(+)** Salt's TB / P&L / balance-sheet / GST are correct from the cutover forward on the double-entry backbone.
- **(−)** Arbitrary *pre-cutover* financial reports can't be regenerated inside Salt from primitives — Marg stays the system of record for pre-cutover audit; mitigated by the optional summary archive.
- **(−)** Pre-cutover party statements show opening balance + open bills (and the imported documents as records), not a replayed transaction-by-transaction GL.
- **Alternative rejected — full GL replay:** needs a complete account/group mapping, rarely reconciles to the paise, is heavy, and would double-count against the opening snapshot.

**Implementation note (pre-built):** the opening-entry backfill exists; the period-summary archive (if pursued) is a small additive table/jsonb, delivered as a migration when built (run by the user).

See [0012](0012-stock-cutover-snapshot-vs-replay.md) · [0011](0011-document-import-idempotency-key.md) · [architecture/marg-import-map](../architecture/marg-import-map.md) · [architecture/proposed-data-model](../architecture/proposed-data-model.md)
