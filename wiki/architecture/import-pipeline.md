---
type: architecture
updated: 2026-05-29
---

# Import pipeline

Onboarding from Marg/Tally/Saral is the leverage point for the whole business (PRD §4.10). Three paths exist:

1. **CSV catalogue importer** — simple template-based import of items.
2. **Go migrator** (`migrator/`) — reads Marg DBF files locally, uploads via `redeem_migration_token`. User downloads the cross-compiled binary from the site.
3. **Smart Importer** (`apps/web/src/components/import/smart`) — the main path. A cascade stepper: **ledgers → items → batches & stock**.

## Smart Importer internals

- **`smartParse.ts`** — `readMatrix(file)` reads CSV (papaparse) or XLS/XLSX (SheetJS) to a raw cell matrix. `parseFile` runs it through `extractTable`; `parseLedgerFile` runs it through `extractLedgerReport`.
- **`smartImport.ts`** — `ENTITIES` (field configs + aliases per entity), `autoMap` (Levenshtein header→field matching), `extractTable` (report-aware extraction tolerant of title blocks, interleaved sub-rows, footers), `partitionRows` / `revalidate` (validate → split into commit-ready vs quarantined), per-entity validators.
- **`EntityStep.tsx`** — generic upload → column-map → import → **quarantine grid** (fix bad cells or bulk-apply a default, re-process). Used for items & batches.
- **`LedgerStep.tsx`** — dedicated ledgers path (the trial balance is too structured for the generic flow). Upload → **review/QA screen** → import. Calls `classify_parties`, generates each ledger's UUID client-side (`crypto.randomUUID()`), inserts `ledgers` with explicit ids, then inserts `ledger_bills` referencing those same ids. Linkage is correct-by-construction — no reliance on `RETURNING` order. Processes in chunks of 500. See [decisions/0007](../decisions/0007-client-side-uuid-generation.md).

## Ledger (trial balance) extraction — `smartLedger.ts`

This is the most domain-specific piece. A Saral/Marg/Tally trial balance is not tabular — it interleaves ledger header rows with per-bill sub-rows. See [domain/trial-balance.md](../domain/trial-balance.md) for the format.

- **`detectColumns`** finds the opening / debit / credit / closing columns from the report's two-line header, then reads values **positionally** (a blank credit/debit cell no longer shifts the others — the bug that caused 49 false mismatches).
- **`parseBill`** matches a bill line: `[markers] [ref?] date amount Dr/Cr [due-date] [days]`, tolerant of `*** *` markers, `(amount Cr)` contra, and blank refs.
- **`extractLedgerReport`** walks the matrix: a ledger row (name + numeric closing) starts a party; following date-bearing sub-rows are its bills; a `Ph.:` line is its phone.
- **`quality`** reports the QA: reconciliation via the **column identity `opening + debit − credit = closing`** (not Σbills), invalid-bill count, unreadable-line count.

**Verified on the real 5,464-row Saral file:** 475 ledgers, 4,344 bills, 0 invalid, 0 unreadable, **475/475 reconcile to the paise**, and the signed balances sum to ₹0 (a complete trial balance must net to zero — an independent correctness check).

## Party de-duplication — `mergeSuggest.ts` + `merge_ledgers`

The trial balance legitimately repeats names (one party as both debtor and creditor). Import stays **faithful** (no auto-collapse); the [Parties screen](../domain/parties.md) suggests merges (GSTIN → identical-invoice-set → name) and the user confirms. See [decisions/0005-faithful-import-and-merge.md](../decisions/0005-faithful-import-and-merge.md).

## Related
[trial-balance](../domain/trial-balance.md) · [parties](../domain/parties.md) · [data-model](data-model.md)
