---
type: decision
updated: 2026-05-29
---

# 0007 — Generate ledger UUIDs client-side

**Status:** accepted · **Date:** 2026-05

## Context

`LedgerStep.tsx` imports ledgers and then links `ledger_bills` to them by `ledger_id`. The original implementation performed a multi-row `INSERT ... RETURNING id` and linked bills by aligning the returned ids to the input slice by index. Postgres does not guarantee that `RETURNING` returns rows in insertion order for a multi-row insert. The code worked in practice, but a future Postgres or PostgREST change could silently attach bills to the wrong party with no observable error at import time.

## Decision

Generate each ledger's UUID client-side using `crypto.randomUUID()` before the `INSERT`. Supply the `id` explicitly in the ledger payload. Construct `ledger_bill` rows using that same `id` as `ledger_id`. The linkage is now **correct-by-construction** and independent of return order. The `.select("id")` call and the index-alignment logic are removed.

Inserts are processed in chunks of `CHUNK = 500` rows to bound memory usage on large trial-balance files.

## Consequences

- **(+)** Correctness is structural: bills link to the right ledger even if Postgres changes return ordering.
- **(+)** Simpler code: no index-based alignment, no `.select()` round-trip.
- **(+)** Verified on the real 5,464-row Saral file: 475 unique UUIDs (no collisions), 4,344 bills linked, 0 orphans.
- **(−)** UUIDs are generated in the browser. `crypto.randomUUID()` is available in all modern browsers (Chromium 92+, Firefox 95+, Safari 15.4+, 2021+). Salt requires a modern browser regardless, so this is not a new constraint.

See [architecture/import-pipeline](../architecture/import-pipeline.md) for the import flow. PR #14.
