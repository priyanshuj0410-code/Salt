---
type: decision
updated: 2026-05-29
---

# 0008 — Import join keys: name for parties, code for products

**Status:** accepted · **Date:** 2026-05

## Context

A real Marg/Saral shop onboards from four exports: a trial balance, a party GST master, an item/HSN master, and a stock report. We needed an ingestion model that absorbs all four faithfully and scales to any Marg/Tally/Saral customer — **without per-file parsing logic**.

Analysis of the real Saral files established the keys:
- `stock.Code == hsn.ItemCode` (the alphanumeric SKU, e.g. `PRL119`) — **7,871/7,871**, zero unmatched, zero duplicates. The numeric `ItemID` is a red herring (matches only 65). The two files are sorted differently but draw from the same code universe.
- The trial balance exposes **only names** — no code — so parties can only join by normalized name.
- The party master legitimately repeats names (412 normalized-name duplicates) and ~33% of rows have no GSTIN.

## Decision

Two "spine + enrichment" clusters, each joined by its only stable key:
- **Parties** join by **normalized name**. Trial Balance is the spine (creates `ledgers`); Party GST Master enriches (fills GSTIN/phone/address/`state_code`, never overwrites). The master is **deduped by normalized name** before applying (first non-null per field); unmatched names are reported, not inserted.
- **Products** join by **`item_code`**. HSN Code Master is the spine (creates `items`, keyed by code); Stock Report enriches (opening stock + cost/MRP), **linking by code first, name as fallback**.

Supporting choices:
- Add `items.item_code` (unique per org), `ledgers.state_code`, `orgs.state_code` (migration 0012).
- **Opening stock = one synthetic batch per item** (`batch_no`/`expiry` null), because the schema is already batch-only and prices live on batches. Real batch granularity arrives via GRN.
- Items insert is an **upsert on `(org_id, item_code)`** so re-import is idempotent.
- **Lose nothing:** every import step also writes the **verbatim source row** to a `source jsonb` on the entity (migration 0013), so columns with no typed home (Cost Price, Sales Price, Rack No., schemes, GST-registration status, party/TIN codes, tax splits) are preserved, not dropped — promotable to typed columns when a feature needs them.
- `autoMap` scoring made **tiered** (exact > substring > fuzzy, ties to first column) so lookalike columns (`ItemCode`/`HSNCode`/`HsnName`, `SGST`/`CGST`/`IGST`/`LocalTax`) map correctly. `gst_rate` reads the combined `IGST` column.

## Consequences

- **(+)** Generalizes: every Marg/Tally/Saral shop has these four files with a party name and a product code; the same field-alias + `autoMap` + `extractTable` machinery handles column variation.
- **(+)** Precise product join: verified 7,871/7,871 by code on the real file, **0 quarantined** — including 28 rows with negative on-hand stock, which is a real-world value (oversold / billed before GRN) and is imported as-is rather than blocked.
- **(+)** Faithful: enrichment never overwrites; the trial balance stays the source of truth for balances.
- **(−)** Parties with neither GSTIN nor a numeric cell can be dropped by `extractTable`'s record filter — acceptable since they carry nothing to enrich; revisit if phone-only enrichment is wanted.
- **(−)** `state_code` is captured but billing CGST/SGST-vs-IGST logic that consumes it is not built yet (needs `orgs.state_code` set too).

See [architecture/import-pipeline](../architecture/import-pipeline.md) and [data-model](../architecture/data-model.md).
