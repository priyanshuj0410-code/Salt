---
type: decision
updated: 2026-05-31
---

# 0010 — GSTIN as canonical party identity

**Status:** accepted (design; pre-implementation) · **Date:** 2026-05-31

## Context

[Decision 0008](0008-import-join-keys.md) joins parties by **normalized name**, because the trial balance exposes only names. That is correct *for the trial balance*. But the Party GST Master — and, as the importer extends to the **account master** and **transaction history** (sales/purchases reference parties) — carry **GSTIN**, a government-issued, 15-character, state-coded unique id for a registered legal entity.

Name-only matching is fragile across these richer files: the same party appears as name variants (`M/s ABC Pharma` vs `ABC Pharma Distributors`), and distinct parties share a name. Meanwhile ~33% of party rows in the real sample have **no** GSTIN (walk-in/unregistered B2C), so GSTIN cannot be the *only* key.

## Decision

Party identity resolves in tiers: **GSTIN (exact, when present) → normalized name (fallback)**.

- **GSTIN is canonical.** Two rows sharing a valid GSTIN are the same legal entity even if their names differ; a name match is a *candidate*, not authoritative.
- This **refines 0008**: `item_code` stays the product key; **GSTIN becomes the primary party key, name the fallback**.
- **Validation/normalization:** GSTIN is uppercased and checked against the GSTIN regex already in `smartImport.ts`; placeholders Marg emits (`URP`, `NA`, blanks) are treated as null → fall back to name.
- **Re-import upsert:** parties upsert on `(org_id, gstin)` when GSTIN is present, else insert + name-dedup (the existing `PartyGstStep` behaviour).
- GSTIN's first two digits encode the **state** → also seed `ledgers.state_code` / interstate logic when absent.
- Import-time matching now uses the same GSTIN-first ranking that `merge_ledgers` suggestions already use ([decision 0005](0005-faithful-import-and-merge.md)) — identity is consistent between import and merge.

## Consequences

- **(+)** Robust matching across files; collapses name variants of one registered entity; correct enrichment and transaction linking.
- **(+)** Embedded state code feeds CGST/SGST-vs-IGST logic.
- **(+)** Deterministic party re-import idempotency via `(org_id, gstin)`.
- **(−)** The ~33% without GSTIN still rely on name — duplicates remain possible there; user-driven merge ([0005](0005-faithful-import-and-merge.md)) stays the backstop.
- **(−)** One physical party with multi-state GST registrations has several GSTINs → treated as distinct legal entities (correct for GST, but may surprise users; merge stays manual).
- **(−)** Requires guarding against garbage GSTINs (validation above).

**Implementation note (pre-built):** `ledgers.gstin` already exists; the importer extension adds a partial unique index `(org_id, gstin) where gstin is not null` for upsert and matches GSTIN-first. To be delivered as a migration when the importer extension is built (migrations are run by the user).

See [0008](0008-import-join-keys.md) · [0005](0005-faithful-import-and-merge.md) · [0011](0011-document-import-idempotency-key.md) · [architecture/marg-import-map](../architecture/marg-import-map.md) · [domain/parties](../domain/parties.md)
