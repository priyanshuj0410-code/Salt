# Salt OCR worker (local Gemma + Ollama)

A small, stateless Node worker that drains the Salt invoice queue on a **founder's
laptop**: it leases a queued invoice, runs it through a **local Gemma vision model
(Ollama)**, and writes the structured result back — landing in the *same* draft-GRN
review flow the paid Gemini Flash lane uses. This makes default purchase-invoice OCR
effectively free (~6h TAT), with Flash reserved for the paid "Fetch now" button and
as an auto-fallback.

This is the **M1** deliverable of [`prd-gemma-ocr-worker.md`](../../prd-gemma-ocr-worker.md).
It depends on migration **`0062_ocr_queue.sql`** (M0) being applied.

> ⚠️ **Accuracy gate first (PRD §14.1).** Before trusting Gemma as the default lane,
> run 20–50 real distributor invoices through your chosen model and score them
> field-by-field (invoice no, GSTIN, and per line: batch, expiry, qty, free, MRP,
> PTR, GST) against Flash. If Gemma is weak on the dense tables, keep `lane=flash`
> the default and run this only to prove the plumbing. The worker emits the exact
> same JSON contract as Flash, so the comparison is apples-to-apples.

---

## How it works

```
ocr_lease_next(queue) ─► download file ─► route by type (extract.ts):
       ▲                                    • CSV / digital PDF (text layer) → text  → Ollama (text)
       │                                    • scanned PDF → rasterize per page (poppler) ┐
   ocr_fail (retry)                         • image → downscale (sips) ─────────────────┤→ Ollama (vision)
       │                                                                  parseModelJson ┘ (+merge pages)
       └──────────────────  ocr_complete(json) ◄───────────────────────────────┘
                              │
              invoice_scans.status='extracted'  ──►  Salt: parse → draft GRN → review → receive_purchase
```

**PDF handling.** Ollama/Gemma cannot read PDFs (only raster images), unlike cloud
Gemini which ingests PDFs directly. So: a **digital PDF** (has a text layer) is read with
`pdftotext` and sent as **text** — no rasterize, no OCR error, fastest + most accurate. A
**scanned PDF** (no text) is rasterized per page (`pdftoppm`, downscaled) and sent to the
vision model, one page per call (an oversized multi-image batch crashes ggml), then the
pages are merged. Photos/images are downscaled with `sips` before vision.

The **server owns durability** (queue rows + files). The worker is stateless and
disposable — if the laptop sleeps or crashes mid-job, the lease expires and the job
is reclaimed (`ocr_reclaim_expired`, run by pg_cron in M4 or `pnpm reclaim` here).
Nothing is lost.

Output parity is guaranteed by [`src/contract.ts`](src/contract.ts), which mirrors
the **exact prompt + JSON extractor** from `supabase/functions/extract-invoice`. If
that prompt ever changes, update both.

---

## Prerequisites

- **Node ≥ 23.6** (this repo runs `.ts` directly via Node's type-stripping — no build
  step). `node --version`.
- **[Ollama](https://ollama.com/download) ≥ 0.30** — install the **macOS app** (`brew install --cask ollama-app`), not the `ollama` CLI formula. Older 0.2x has a Metal residency-set bug on macOS 14+ that crashes the runner mid-extraction (`ggml-metal-device.m … GGML_ASSERT([rsets->data count] == 0)`), and the brew *formula* bottle has shipped without the `llama-server` runner. The app bundles a working runtime; the `ollama` CLI still works as a client against it.
- **poppler** for PDFs: `brew install poppler` (provides `pdftotext` for digital PDFs +
  `pdftoppm` to rasterize scanned ones). Image downscaling uses `sips` (ships with macOS).

### Pull a Gemma vision model

The model **must report the `vision` capability** — check with `ollama show <tag>`.
Size it to the machine (final tag confirmed by the §14.1 eval):

| Machine | Role | Tag | Notes |
|---|---|---|---|
| M4, 24 GB | burst worker | `gemma4:26b-a4b-it-q4_K_M` | ✅ verified vision; ~19 GB loaded, ~43s warm/invoice |
| Intel, 16 GB | always-on baseline | `gemma3:4b` | the 19 GB gemma4 won't fit 16 GB |

```bash
ollama pull gemma4:26b-a4b-it-q4_K_M     # then set OCR_MODEL to it
ollama show  gemma4:26b-a4b-it-q4_K_M     # confirm "Capabilities: vision"
```

Ollama serves at `http://localhost:11434`. Because the worker runs on the **same
laptop**, there is no tunnel and nothing is exposed to the internet.

> **Verified end-to-end (M4, 24 GB):** a synthetic distributor invoice through
> `gemma4:26b-a4b-it-q4_K_M` returned the exact `OcrInvoiceJson` contract —
> invoice no, date, 15-char GSTIN and most line fields correct. It *did* misread a
> vendor name and one row's qty, so this is a plumbing proof, **not** a pass on the
> §14.1 accuracy gate — run that on real bills before flipping the default lane.
> A cold model load can take minutes; `OLLAMA_TIMEOUT_MS` (default 10 min) covers it.

---

## Setup & run

```bash
cd workers/ocr-worker
pnpm install --ignore-workspace   # standalone package; --ignore-workspace avoids the Salt root workspace (or: npm install)
cp .env.example .env              # then fill SUPABASE_URL + SUPABASE_SERVICE_KEY + OCR_MODEL
pnpm typecheck               # optional sanity check
pnpm once                    # lease + process ONE job, then exit (end-to-end smoke)
pnpm start                   # the poll loop (leave running)
```

`SUPABASE_SERVICE_KEY` is **Settings → API → service_role (secret)** in the Supabase
dashboard. It bypasses RLS — keep it on the laptop, never commit `.env`, never put it
in `apps/web`.

### Running both laptops

Run one instance per machine against the same queue, each with its own identity and
model:

```bash
# M4
WORKER_ID=m4 OCR_MODEL=gemma3:12b pnpm start
# Intel
WORKER_ID=intel OCR_MODEL=gemma3:4b pnpm start
```

`ocr_lease_next` uses `FOR UPDATE SKIP LOCKED`, so multiple workers never grab the
same job.

### Lease reclaim

If you are **not** yet running the pg_cron tick (M4), reclaim crashed leases
periodically:

```bash
pnpm reclaim          # one-shot; e.g. wire to cron/launchd every 15 min
```

---

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `SUPABASE_URL` | — (required) | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | — (required) | service_role secret; laptop only |
| `OLLAMA_HOST` | `http://localhost:11434` | local Ollama |
| `OCR_MODEL` | — (required) | the vision tag you pulled |
| `WORKER_ID` | `<hostname>-<pid>` | unique per machine |
| `OCR_LANES` | `queue` | `queue,flash` to also drain escalations locally |
| `LEASE_SECONDS` | `300` | lease window; auto-renewed at half |
| `POLL_INTERVAL_MS` | `5000` | idle poll cadence |
| `CONCURRENCY` | `1` | parallel drain lanes (a laptop vision model is usually the bottleneck) |
| `OCR_BUCKET` | `invoice-scans` | private Storage bucket |
| `MAX_IMAGE_PX` | `1500` | PDF rasterize downscale (longest side) |
| `OLLAMA_TIMEOUT_MS` | `600000` | idle ceiling for the Ollama call (cold loads run minutes) |
| `OLLAMA_NUM_CTX` | `8192` | context window — keep **> num_predict + input** or Ollama shifts the KV cache and crashes the runner |
| `OLLAMA_NUM_PREDICT` | `4096` | max generated tokens — stops runaway models hanging (gemma4 stops on its own) |

---

## Security (PRD §7)

Two modes, chosen by which env you set:

- **v1 (simple):** set `SUPABASE_SERVICE_KEY`. The laptop holds the service-role key and
  calls the RPCs + Storage directly. Acceptable for a trusted local worker; the key never
  reaches a browser.
- **Hardened (M6):** leave `SUPABASE_SERVICE_KEY` blank and set `WORKER_SECRET` instead.
  Every privileged op (lease/renew/complete/fail/reclaim, registry, file URLs) routes
  through the `ocr-proxy` Edge Function, which holds the service role *server-side* — so
  the powerful key never leaves Supabase. One-time setup on the project:

  ```bash
  supabase functions deploy ocr-proxy --no-verify-jwt   # the worker auths via the secret header, not a JWT
  supabase secrets set WORKER_SECRET=<long-random-string>
  ```

  Then on each laptop: `WORKER_SECRET=<same value>` in `.env`, `SUPABASE_SERVICE_KEY` empty.

## Troubleshooting

- **`Ollama 404: model not pulled`** — `ollama pull <OCR_MODEL>`; confirm `ollama list`.
- **`pdftoppm failed`** — `brew install poppler`.
- **`model runner has unexpectedly stopped`** / `GGML_ASSERT([rsets->data count] == 0)` — Ollama Metal bug in 0.2x. Upgrade to the **Ollama.app ≥ 0.30** (`brew install --cask ollama-app`); the worker also retries the runner once automatically.
- **`llama-server binary not found`** — the brew *formula* `ollama` 0.30.x bottle is missing the runner. Use the cask app instead (`brew install --cask ollama-app`).
- **`Missing required env`** — copy `.env.example` → `.env` and fill it in.
- **Jobs never appear** — confirm `0062_ocr_queue.sql` is applied and shops are
  uploading on `lane=queue` (M2); check the operator console / `invoice_scans`.
- **A job keeps retrying** — `attempts` climbs to `max_attempts` then goes `failed`;
  the `error` column holds the last message. Inspect with the operator console (M5).
