---
type: decision
updated: 2026-05-29
---

# 0003 — Money as integer paise

**Status:** accepted · **Date:** 2026-05

## Context
Financial software; floating-point rupees accumulate rounding errors and break reconciliation. Indian balances reach crores.

## Decision
Store all money as **integer paise**. Columns are suffixed `*_paise`; balances that can be large use **`bigint`** (`opening_balance_paise`, `amount_paise`, `credit_limit_paise`, `mrp_paise`, `ptr_paise`). Convert at the edges only — divide by 100 for display via `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`.

## Consequences
- **+** Exact arithmetic; reconciliation holds to the paise (the trial-balance column identity reconciles 475/475 exactly, and signed balances net to ₹0).
- **+** No float drift across debit/credit/closing.
- **−** Every read/write must remember the ×100 scale; a missed conversion is a 100× bug. Parsers (`toPaise`) and formatters live in one place.
