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
ocr_lease_next(queue)  ──►  download file (private bucket)  ──►  rasterize PDF→PNG (poppler)
       ▲                                                              │
       │                                                     Ollama vision (Gemma, JSON)
   ocr_fail (retry/backoff)                                          │
       │                                                     parseModelJson
       └────────────  ocr_complete(json) ◄───────────────────────────┘
                              │
              invoice_scans.status='extracted'  ──►  Salt: parse → draft GRN → review → receive_purchase
```

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
- **[Ollama](https://ollama.com/download)** (macOS app or `brew install ollama`).
- **poppler** for PDF rasterization: `brew install poppler` (provides `pdftoppm`).

### Pull a Gemma vision model

Size the model to the machine (final tag confirmed by the §14.1 eval):

| Machine | Role | Suggested tag |
|---|---|---|
| M4, 24 GB | burst worker | `ollama pull gemma3:12b` |
| Intel, 16 GB | always-on baseline | `ollama pull gemma3:4b` |

Ollama serves at `http://localhost:11434`. Because the worker runs on the **same
laptop**, there is no tunnel and nothing is exposed to the internet.

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

---

## Security (PRD §7)

- **v1 (this):** the laptop holds the **service-role key** and calls the RPCs
  directly. Acceptable for a trusted local worker. The key never reaches a browser.
- **Hardening (M6, recommended next):** the laptop holds only a `WORKER_SECRET`;
  lease/complete/fail go through thin Edge Functions that verify the secret and use
  the service role *server-side*, so the powerful key never leaves Supabase.

## Troubleshooting

- **`Ollama 404: model not pulled`** — `ollama pull <OCR_MODEL>`; confirm `ollama list`.
- **`pdftoppm failed`** — `brew install poppler`.
- **`Missing required env`** — copy `.env.example` → `.env` and fill it in.
- **Jobs never appear** — confirm `0062_ocr_queue.sql` is applied and shops are
  uploading on `lane=queue` (M2); check the operator console / `invoice_scans`.
- **A job keeps retrying** — `attempts` climbs to `max_attempts` then goes `failed`;
  the `error` column holds the last message. Inspect with the operator console (M5).
