---
type: decision
updated: 2026-05-29
---

# 0005 — Faithful import + user-driven merge (not auto-dedup)

**Status:** accepted · **Date:** 2026-05

## Context
The trial balance lists some party names multiple times. Inspection showed these are **real distinct accounts** — e.g. MANKIND PHARMA appears once as a receivable (+₹1.15L) and once as a payable (−₹2.31L): the same vendor under both debtor and creditor groups. Naive "dedup by name" (sum or last-wins) would corrupt balances — merging a receivable and a payable, or silently dropping bills.

## Decision
- **Import stays faithful** — every source ledger row becomes its own party (its own UUID). No auto-collapse.
- **De-duplication is a user-driven, suggest-and-confirm merge** on the Parties screen. Suggestions are ranked: **same GSTIN** (same legal entity) → **identical invoice-id set** (accidental re-import) → **same normalized name** (review). Nothing merges automatically.
- **GSTIN is the canonical identity key** once parties have one (the trial balance carries none yet; merge currently relies on name + invoice-id).
- Merging is one atomic RPC (`merge_ledgers`): re-point bills to the survivor, **sum signed balances** (net preserved), adopt missing gstin/phone/address, delete merged rows.

## Consequences
- **+** No silent financial corruption; the human owns every merge.
- **+** The "identical invoice-id set" signal also cleans accidental double-imports.
- **−** The user must do merge work the import won't guess at; mitigated by ranked suggestions.
- Verified: single faithful import → ~15 name-candidate groups, 0 invoice-set; double-import sim → 353 invoice-set pairs. See [../domain/parties.md](../domain/parties.md).
