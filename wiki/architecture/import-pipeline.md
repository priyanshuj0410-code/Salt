---
type: architecture
updated: 2026-05-29
---

# Import pipeline

Onboarding from Marg/Tally/Saral is the leverage point for the whole business (PRD §4.10). Three paths exist:

1. **CSV catalogue importer** — simple template-based import of items.
2. **Go migrator** (`migrator/`) — reads Marg DBF files locally, uploads via `redeem_migration_token`. User downloads the cross-compiled binary from the site.
3. **Smart Importer** (`apps/web/src/components/import/smart`) — the main path. A four-step cascade stepper: **ledgers → party details → items → batches & stock**.

## The four files map to two "spine + enrichment" clusters

A real Marg/Saral shop exports four files that pair up by a stable join key:

| Cluster | Spine (creates rows) | Enrichment/snapshot | Join key |
|---|---|---|---|
| **Parties** | Trial Balance → `ledgers` + balances + `ledger_bills` | Party GST Master → fill GSTIN / phone / address / `state_code` | normalized **name** |
| **Products** | HSN Code Master → `items` (identity, HSN, tax, salt) | Stock Report → opening stock + cost/MRP | **`item_code`** |

The trial balance only exposes names, so parties join by normalized name; the product files share a stable per-shop code (`stock.Code == hsn.ItemCode`), so products join by `item_code` — verified **7,871/7,871** on the real Saral export. This generalizes to any Marg/Tally/Saral customer; no per-file logic. See [decisions/0008](../decisions/0008-import-join-keys.md).

**Nothing is discarded.** Beyond the typed columns the app queries, every import step keeps the **verbatim source row** in the entity's `source jsonb` (migration 0013) — `items.source` and `batches.source` hold the full `hsncodemaster`/`stock_81` rows (Cost Price, Sales Price, Rack No., schemes, tax splits…); `ledgers.source` holds `{ trial_balance, gst_master }`. Unmapped columns are preserved for later promotion, not dropped.

## Smart Importer internals

- **`smartParse.ts`** — `readMatrix(file)` reads CSV (papaparse) or XLS/XLSX (SheetJS) to a raw cell matrix. `parseFile` runs it through `extractTable`; `parseLedgerFile` runs it through `extractLedgerReport`.
- **`smartImport.ts`** — `ENTITIES` (field configs + aliases per entity), `autoMap` (header→field matching), `extractTable` (report-aware extraction tolerant of title blocks, interleaved sub-rows, footers), `partitionRows` / `revalidate` (validate → split into commit-ready vs quarantined), per-entity validators.
  - **`autoMap` scoring is tiered** — an exact column-name match strictly beats a substring match, and ties resolve to the first column. Without this, lookalike columns in real exports (`ItemCode` vs `HSNCode` vs `HsnName`; `SGST`/`CGST`/`IGST`/`LocalTax`) mis-map. `gst_rate` reads the combined `IGST` column (= SGST+CGST).
- **`EntityStep.tsx`** — generic upload → column-map → import → **quarantine grid** (fix bad cells or bulk-apply a default, re-process). Used for items & batches. Items **upsert on `(org_id, item_code)`** (idempotent re-import); the stock step builds `itemByCode` + `itemByName` and **links by code first, name as fallback**.
- **`LedgerStep.tsx`** — dedicated ledgers path (the trial balance is too structured for the generic flow). Upload → **review/QA screen** → import. Calls `classify_parties`, generates each ledger's UUID client-side (`crypto.randomUUID()`), inserts `ledgers` with explicit ids, then inserts `ledger_bills` referencing those same ids. Linkage is correct-by-construction — no reliance on `RETURNING` order. Processes in chunks of 500. See [decisions/0007](../decisions/0007-client-side-uuid-generation.md).
- **`PartyGstStep.tsx`** — party enrichment **and** completion. `autoMap`s the GST master, **dedupes incoming rows by normalized name** (first non-null wins per field — masters legitimately repeat names), matches to existing `ledgers` by normalized name. Matched → **fill only null fields** (never overwrites) + record the full master row to `source.gst_master`. **Unmatched → inserted as new ledgers** (classified via `classify_parties`, `opening_balance_paise` 0, `source.gst_master`) — the trial balance only lists parties with an open balance, but the GST master is the shop's *full* party list, so the rest are the shop's other customers/suppliers. On the real file: ~315 enriched + ~1,365 added. Opening stock becomes **one synthetic batch per item** (`batch_no`/`expiry` null); real batch+expiry granularity arrives later via GRN.

## Ledger (trial balance) extraction — `smartLedger.ts`

This is the most domain-specific piece. A Saral/Marg/Tally trial balance is not tabular — it interleaves ledger header rows with per-bill sub-rows. See [domain/trial-balance.md](../domain/trial-balance.md) for the format.

- **`detectColumns`** finds the opening / debit / credit / closing columns from the report's two-line header, then reads values **positionally** (a blank credit/debit cell no longer shifts the others — the bug that caused 49 false mismatches).
- **`parseBill`** matches a bill line: `[markers] [ref?] date amount Dr/Cr [due-date] [days]`, tolerant of `*** *` markers, `(amount Cr)` contra, and blank refs.
- **`extractLedgerReport`** walks the matrix: a ledger row (name + numeric closing) starts a party; following date-bearing sub-rows are its bills; a `Ph.:` line is its phone.
- **`quality`** reports the QA: reconciliation via the **column identity `opening + debit − credit = closing`** (not Σbills), invalid-bill count, unreadable-line count.

**Verified on the real 5,464-row Saral file:** 475 ledgers, 4,344 bills, 0 invalid, 0 unreadable, **475/475 reconcile to the paise**, and the signed balances sum to ₹0 (a complete trial balance must net to zero — an independent correctness check).

## Party de-duplication — `mergeSuggest.ts` + `merge_ledgers`

The trial balance legitimately repeats names (one party as both debtor and creditor). Import stays **faithful** (no auto-collapse); the [Parties screen](../domain/parties.md) suggests merges (GSTIN → identical-invoice-set → name) and the user confirms. See [decisions/0005-faithful-import-and-merge.md](../decisions/0005-faithful-import-and-merge.md).

## Beyond the four files

Today's cascade fills **masters + opening balances** only. The full model (0014–0024) is now live, so the next step is extending Smart Import to ingest Marg's transaction history, accounting and compliance exports too. The complete Marg-export → Salt-table scope — every file, its target table(s), join keys, and the decisions it forces — is mapped in [marg-import-map](marg-import-map.md).

## Related
[marg-import-map](marg-import-map.md) · [trial-balance](../domain/trial-balance.md) · [parties](../domain/parties.md) · [data-model](data-model.md)
