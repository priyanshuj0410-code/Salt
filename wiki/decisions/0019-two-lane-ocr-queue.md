---
type: decision
updated: 2026-06-03
tags: [ocr, purchase, queue, worker, gemma, flash, cost]
---

# 0019 — Two-lane invoice OCR: free local Gemma queue + paid Flash

**Status:** accepted (build of `prd-gemma-ocr-worker.md`, M0–M6).

## Context
Invoice extraction ran only through Gemini Flash (`extract-invoice` + `process-scans`), so every scan cost API money. The PRD adds a near-zero-cost lane: a durable Supabase queue drained by a **local Gemma vision worker** (Ollama on the founder's laptop), with Flash kept as the paid/instant lane + a fallback so the TAT always holds. Several design forks had to be settled against the as-built code (committed ≠ applied — probed first).

## Decisions
1. **Extend `invoice_scans`, not a new table.** It is the *live* table the review path already consumes (`extract-invoice`/`process-scans` → scan history → `receive_purchase`). A new `ocr_jobs` would orphan that path; the 0024 `purchase_ocr_jobs` is vestigial (unread). Per the PRD's own rule ("prefer ALTER when columns overlap; downstream untouched"). Term mapping keeps the UI unchanged: PRD `done` → existing `extracted`; PRD `source_doc_no` → existing `invoice_no` (0061). Migration **0062**.
2. **Default lane = free queue (user decision).** Uploads create `lane=queue` jobs drained by the worker; Flash is opt-in ("Fetch now") + auto-fallback. The §14.1 accuracy eval (Gemma vs Flash on 20–50 real bills) is a **prerequisite the user must run** — only they have Ollama + real invoices. A 1-invoice smoke proved the pipeline but misread a vendor name + one qty, so this is a deliberate, reversible flip (one switch), not a claim that local accuracy is sufficient.
3. **`process-scans` becomes the flash-lane driver.** It drains only `lane=flash` and routes terminal state through `ocr_complete`/`ocr_fail` (shared idempotency/dedup with the Gemma lane), and gains a service-role cross-org mode for the cron.
4. **Idempotency in RPC logic, not a unique index.** 0061 deliberately chose a *non-unique* `(org_id, invoice_no)` index (dedup-by-lookup across channels); the live table may hold legit repeats. `ocr_complete` marks duplicates instead of risking a constraint rejection on existing data.
5. **Worker auth: ship both modes.** v1 = service-role key on the laptop (simple, trusted local box). Hardened (M6) = only `WORKER_SECRET` on the laptop, every op via the `ocr-proxy` edge function (service role server-side). Dual-mode in `db.ts`, chosen by which env is set.
6. **Worker uses `node:http`, not `fetch`.** An end-to-end run surfaced undici's ~300s headers-timeout killing cold large-model vision passes; `node:http` with `OLLAMA_TIMEOUT_MS` removes the cap.

## Why not the alternatives
- *New `ocr_jobs` table:* would duplicate the scan-history + draft-GRN consumption path the PRD insists stays untouched.
- *Keep Flash default until the eval:* the user explicitly chose to flip now; the flip is one line of policy and fully reversible, and the queue plumbing is valuable either way.
- *Unique idempotency constraint:* unsafe against existing non-unique data; logic-level dedup matches the as-built 0061 model.
- *Hardened-only auth:* v1 (service key on a trusted laptop) is the fastest path to first value; the proxy is the documented next step, not a blocker.

## Consequences
- Gemini spend drops to revenue-covered instant calls + a bounded fallback trickle; the `/admin/ocr` cost meter is a **rough** estimate until pricing (§14.5) is set.
- TAT holds even with all laptops offline (pg_cron escalate + pg_net Flash drain, 0063) — but that path needs pg_cron/pg_net/Vault enabled; it degrades to "jobs wait on `lane=flash`" otherwise.
- Both laptops can share the queue safely (`FOR UPDATE SKIP LOCKED`).
- Migrations **0062–0064** are user-run (Supabase SQL editor); `extract-invoice`/`process-scans`/`ocr-proxy` are user-deployed. Rollout order documented in the PR + worker README.

## Related
[architecture/ocr-queue](../architecture/ocr-queue.md) · [architecture/grn](../architecture/grn.md) · [decisions/0011 (idempotency key)](0011-document-import-idempotency-key.md) · [decisions/0001 (Supabase backend)](0001-supabase-as-backend.md) · `prd-gemma-ocr-worker.md`
