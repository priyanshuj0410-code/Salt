---
type: architecture
updated: 2026-06-03
tags: [ocr, purchase, queue, worker, gemma, flash]
---

# Two-lane OCR queue (local Gemma + Flash)

Supplier-invoice OCR runs in **two lanes** so default extraction is effectively free while instant stays available for pay. Built from `prd-gemma-ocr-worker.md` (M0–M6). Both lanes land in the **existing** draft-GRN review path — never auto-post.

- **`queue` (default, free):** uploads create `lane=queue` jobs that a **local Gemma vision worker** (Ollama, on the founder's laptop) drains async (~6h TAT).
- **`flash` (paid/instant + fallback):** "Fetch now" or a stale-job escalation flips a job to `lane=flash`, drained by Gemini Flash via the existing `extract-invoice`.

```
upload (PDF/photo) ─► invoice_scans (lane=queue, pending)
                          │                         ▲ "Fetch now" / cron escalate → lane=flash
   local Gemma worker ────┤                         │
   lease→vision→complete  │                 process-scans (flash driver) → ocr_complete(model=flash)
                          ▼
        status=extracted ──► scan history → parse → DRAFT GRN → review → receive_purchase
```

## Data model — extend, don't reinvent

The queue is the **live `invoice_scans` table** (0049/0060/0061) extended in **`0062_ocr_queue.sql`**, *not* a new `ocr_jobs` table and *not* the vestigial `purchase_ocr_jobs` (0024, unread by any code). Rationale + term mapping in [decisions/0019](../decisions/0019-two-lane-ocr-queue.md). Added: `lane`, `priority`, `worker_id`, `model`, `lease_expires_at`, `attempts`/`max_attempts`, `queued_at` (mutable TAT/backoff clock), `leased_at`, `completed_at`, `escalated_at`; status enum gains `leased`/`superseded`. PRD `done`→ existing `extracted`; PRD `source_doc_no`→ existing `invoice_no`. New table `ocr_workers` (registry; online/offline derived from `last_seen_at`).

**RLS:** members read/insert their org's scans (0049); Salt admins read all (0062, for the console); the worker writes only via SECURITY DEFINER RPCs (service role) or the `ocr-proxy` edge function.

## The RPCs (the only write path) — `0062` + `0064`

| RPC | Role | What |
|---|---|---|
| `ocr_lease_next(worker, model, secs, lanes[])` | worker | atomic claim (`FOR UPDATE SKIP LOCKED`), `pending→processing`, sets lease + `attempts++`; heartbeats the worker |
| `ocr_renew_lease` / `ocr_complete` / `ocr_fail` | worker | extend lease; store result (`→extracted`, dedup→`duplicate`, model tag); retry with `queued_at` backoff or terminal `failed` |
| `ocr_reclaim_expired()` | cron | crashed leases (`lease_expires_at < now`) back to `pending` |
| `ocr_request_instant(job)` | member | "Fetch now": flip to `lane=flash`, re-queue hot (this *is* the supersede) |
| `ocr_escalate_stale(interval)` | cron | `queue` jobs older than 5h → `lane=flash` (TAT guarantee) |
| `ocr_admin_retry / _escalate / _cancel / _set_priority` | salt admin | console actions (`is_salt_admin()`-gated) |

## The worker — `workers/ocr-worker/`

Standalone Node/TS (run directly via Node ≥23.6 type-stripping, like `migrator/` is standalone Go; outside the pnpm workspace). Loop: `ocr_lease_next(['queue'])` → download file → **`extract.ts` routes by type** → `ocr_complete`. Routing (Ollama/Gemma cannot read PDFs — only raster images — unlike cloud Gemini): **digital PDF** (text layer) → `pdftotext` → Ollama **text** (no rasterize, no OCR error); **scanned PDF** → `pdftoppm` rasterize per page (downscaled ~1500px) → Ollama **vision** one page per call (an oversized multi-image batch crashes ggml) → merge pages; **image** → `sips` downscale → vision; **CSV** → text. The **prompt + JSON extractor are mirrored verbatim** from `extract-invoice` (`src/contract.ts`) for output parity. Server owns durability; a crashed laptop only *delays* jobs (lease reclaim). `FOR UPDATE SKIP LOCKED` lets both laptops (M4 24GB → `gemma4:26b-a4b-it-q4_K_M`; Intel 16GB → smaller) share the queue.

**Auth (two modes, [decisions/0019](../decisions/0019-two-lane-ocr-queue.md)):** v1 holds the service-role key on the laptop; hardened (M6) holds only `WORKER_SECRET` and routes every op through the `ocr-proxy` edge function (service role stays server-side). Uses `node:http` not `fetch` — undici's ~300s headers cap was killing cold large-model vision passes (caught by an end-to-end run on the M4).

**Verified end-to-end on the M4/24GB:** a synthetic invoice through `gemma4:26b-a4b-it-q4_K_M` returned the exact `OcrInvoiceJson` (invoice no, date, 15-char GSTIN, most line fields), ~43s warm. It misread a vendor name + one row qty — a plumbing proof, **not** a pass on the §14.1 accuracy gate.

## Fallback & scheduling — `0063`

`ocr_cron_tick()` (pg_cron every 15 min) reclaims expired leases, escalates stale queue jobs to flash, then (best-effort via **pg_net** + **Vault** secrets) POSTs `process-scans` so Flash drains them **even with every laptop offline**. Degrades gracefully: the function is always created; missing pg_cron/pg_net/Vault just prints a NOTICE and leaves jobs on `lane=flash` for a worker/manual Fetch.

## Tenant + operator UX (`apps/web`)

- **Upload** (`OcrInvoiceImportPage`): PDFs/photos → free queue (no Gemini call); CSVs still parse client-side (free+instant).
- **Scan history** (`InvoiceScansPage`): lane-aware chips (`Queued · ~6h` vs `Fetching…`), Queued/Fetching stat cards, per-row **Fetch now (instant)**.
- **Operator console** (`/admin/ocr`, `OcrConsolePage`, `is_salt_admin()`): cross-tenant queue + worker health + metrics (oldest lag, done/hr, failure rate, Flash calls + est ₹) + retry/escalate/cancel/bump.

## Status vs PRD open questions (§14)

Resolved in build: default lane = **free queue** (user decision; §14.1 accuracy eval still the user's to run on real bills first); extend `invoice_scans` (§14.3); pg_cron + pg_net for fallback (§14.4); v1 service-key **and** hardened proxy both shipped (§14.6); **text-layer-first PDF handling + per-page multi-page merge** (§14.7) — digital PDFs go via `pdftotext`, scans rasterize per page. Still open/owner: the formal accuracy eval (§14.1), exact tags per machine (§14.2), instant-lane **pricing/packaging** (§14.5, the console cost meter is a rough estimate).

## Related
[grn](grn.md) · [import-pipeline](import-pipeline.md) · [data-model](data-model.md) · [security-rls](security-rls.md) · [decisions/0019](../decisions/0019-two-lane-ocr-queue.md) · [decisions/0011 (idempotency key)](../decisions/0011-document-import-idempotency-key.md)
