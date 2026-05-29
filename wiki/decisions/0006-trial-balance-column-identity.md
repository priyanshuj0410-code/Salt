---
type: decision
updated: 2026-05-29
---

# 0006 — Reconcile by the column identity, parse by detected columns

**Status:** accepted · **Date:** 2026-05

## Context
Validating trial-balance parsing needs a correctness check. Two candidates: (a) do a party's bills sum to its closing balance, or (b) does `opening + debit − credit = closing`. Early attempts used (a) and ~283/363 ledgers "failed" — because the sub-rows are open invoices plus a brought-forward opening, and a party can have both a debtor and a creditor side, so Σbills ≠ closing is *expected*.

## Decision
- **Reconcile by the column identity** `opening + debit − credit = closing` (tolerance ₹1 for paise rounding). This is the accounting truth a correct trial balance satisfies per row. Bill-level QA is separate: count invalid bills (missing date/amount/nature) and unreadable lines.
- **Parse columns positionally from the detected header** (opening/debit/credit/closing), not by filtering out blank cells. A blank debit/credit must not shift the remaining values.

## Consequences
- **+** On the real 5,464-row file: 475/475 reconcile **exactly** (0 paise), 0 invalid bills, 0 unreadable lines; signed balances sum to ₹0 (independent whole-file check).
- **+** Wrong parses surface **loudly** in the QA screen (unbalanced / invalid / unreadable) rather than importing silently-wrong data.
- **−** Header detection assumes English-ish labels (`opening`/`debit`/`credit`/`closing`); a differently-labeled export falls back to a weaker heuristic. Bill-line parsing is shaped to the one-cell-per-bill Saral layout; other ERPs may differ → such lines land in "unreadable" (visible), not dropped.

See [../domain/trial-balance.md](../domain/trial-balance.md).
