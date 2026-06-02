---
type: architecture
updated: 2026-06-01
tags: [ops, nfr, reliability, security, compliance, scalability]
---

# Operations & NFR posture

The non-functional posture of Salt — reliability, security, compliance, scalability — and the runbooks for each. Salt has **no servers of its own**: the backend is [Supabase](stack.md) (managed Postgres + PostgREST + Auth + RLS). So most of the NFR baseline is *inherited* from the Supabase project's plan and region, and the infra work is (a) documenting that baseline + the runbooks, and (b) raising the few **account-owner actions** that only the project owner can take from the Supabase dashboard. Those are collected in [Action items](#action-items) at the bottom.

Covers tickets **SALT-134** (reliability), **SALT-136** (security), **SALT-137** (compliance), **SALT-138** (scalability) — re-homed from the `nfr` lane to `infra` as platform/ops.

## Reliability — backups & recovery (SALT-134)

**Baseline (Supabase managed Postgres).** Confirm on the project's plan in the dashboard:
- **Daily logical backups** are taken automatically (Pro plan and above; typical retention 7 days, longer on higher tiers).
- **Point-in-Time Recovery (PITR)** is a paid add-on giving recovery to a fine (≈2-minute) granularity via WAL archiving. It is **off by default** and must be enabled.

**Targets (proposed).**
- **RPO** (max data loss): ≤ 5 min with PITR enabled; otherwise up to 24 h (last daily backup).
- **RTO** (max time to restore): ≤ 1 h for a full project restore.

**Restore runbook.**
1. In the Supabase dashboard → Database → Backups, pick the restore point (a daily backup, or a PITR timestamp).
2. Supabase restores into the project (or a clone). Note: a restore is destructive to data written after the chosen point — take a fresh backup first if the current state matters.
3. After restore, re-run the migration sanity check: `supabase/migrations/` should be a contiguous `0001`–`0024` + `0025`–`0031` (see [data-model](data-model.md)); the app is stateless on Vercel and needs no redeploy.
4. Verify with a smoke read (a known org's trial balance nets to 0; recent bills present) before reopening counters.

**Zero-loss *local* durability** (bill through a power/network cut with no loss) depends on the **offline-first substrate** — that is **SALT-135** (blocked on the sync substrate, see [roadmap](../product/roadmap.md)), **out of scope here**.

## Security — encryption, logs, PII (SALT-136)

- **In transit:** all client↔Supabase traffic is HTTPS/TLS (the `@supabase/supabase-js` client only speaks HTTPS).
- **At rest:** Supabase encrypts Postgres storage at rest (AES-256 on the underlying volume). Inherited from the platform; confirm on the project's plan.
- **Tenancy isolation:** every business table is deny-by-default **RLS** gated on `is_member(org_id)` — see [security-rls](security-rls.md). This is the primary safeguard against cross-org PII exposure.
- **No plaintext PII in client logs — verified.** The only `console.*` in `apps/web/src` is the PII-safe `ErrorBoundary` (it logs the error/stack, not user data). There is no analytics/telemetry that ships field values. Re-check this whenever a `console.*` is added (consider an eslint `no-console` rule with an ErrorBoundary exception as a future guard).
- **Secrets:** only the Supabase **publishable/anon** key is in the client bundle (safe by design — RLS enforces access). The service-role key and DB password are never shipped client-side.

**GDPR / DPDP export + erase** (right to access + erasure of a party's PII): **not built**. This needs a security-definer RPC (`export_party_pii` / `erase_party_pii`, the latter scrubbing name/phone/address/GSTIN while preserving the immutable financial ledger for statutory retention) plus a minimal owner-settings UI. That is **DB + settings work, not infra** — filed as **SALT-188** (`database`). Data **export** may already be partly served by SALT-093 (Data export/backup).

## Compliance — residency & audit trail (SALT-137)

**Data residency (India).** Supabase pins data to the **region chosen at project creation** and the region **cannot be changed afterward** (moving regions = migrate to a new project). For Indian medical-retail compliance the project must live in an **India region (`ap-south-1`, Mumbai)**. This is an **account-owner action**: confirm the current project's region in the dashboard; if it is not in India, run the migration below. (Per the linked CLI project ref `fvjxngtqqmgjfevnoqlu`, Salt currently appears to be in **Sydney `ap-southeast-2`** — confirm in the dashboard; if so it is **not** an India region and needs the migration.)

### Region-migration runbook (Sydney → `ap-south-1` Mumbai)

Supabase has **no in-place region change**, so residency means migrating to a **new project** in Mumbai and cutting over. This is a planned **maintenance-window** cutover over **real data** — auth users, the `whatsapp-send` edge function, and OAuth config, not just the DB. Run it when counters are idle; keep the old project **paused, not deleted** for a rollback window.

**0 · Prep.** Verify the source region (Project Settings → Infrastructure). Record both projects' ref / URL / anon + service-role keys / DB password (handle securely; never commit). Install a `pg_dump`/`psql` **≥ the server's major version** — Salt's server is **Postgres 17**, so Homebrew `postgresql@17` (a v16 client aborts with "server version mismatch").

**Path A — Supabase-assisted (recommended on Pro+).** Open a Supabase support request for a region migration / physical restore into a new `ap-south-1` project. This preserves `auth` / `storage` cleanly — the part the DIY path most often breaks — and is the safest route when PITR is on.

**Path B — DIY dump & restore.**
1. **Create** the new project in `ap-south-1`; enable the same extensions the migrations use (e.g. `pgcrypto`).
2. **Freeze writes:** put the app in maintenance / pause counters so no bill lands mid-dump.
3. **Dump only the tables you need — NOT whole schemas.** Dumping all of `auth`/`storage` aborts on platform-owned internal tables the `postgres` role can't write (`storage.buckets_vectors`, `auth.schema_migrations`). Dump `public` + just the auth user tables; migrate Storage separately (step 5):
   ```
   pg_dump "$SRC" -f schema.sql    --schema=public --no-owner
   pg_dump "$SRC" -f data_pub.sql  --schema=public --data-only --no-owner
   pg_dump "$SRC" -f data_auth.sql --data-only --no-owner -t auth.users -t auth.identities   # + auth.mfa_factors if MFA
   ```
   (`supabase db dump` auto-excludes the internal tables but runs pg_dump in Docker.)
4. **Restore** with FK/trigger checks off (handles the `chart_accounts` circular FK + cross-schema FKs):
   ```
   psql -d "$DST" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql -c 'SET session_replication_role = replica' -f data_auth.sql -f data_pub.sql
   ```
   Verify sequences (`invoice_series` / serials) carried so invoice numbers don't reset or collide.
5. **Storage migrates separately** (the files live in object storage, not Postgres — `pg_dump` only moves metadata rows). For the `invoice-scans` OCR bucket (migration `0049`): recreate the bucket + its `storage.objects` policies on the new project (re-run 0049's storage block in the SQL editor), then copy the files old→new via the Storage API (service-role on both — a `@supabase/supabase-js` list → download → upload script).

**⚠️ Does NOT migrate with the DB — do these separately (the gap):**
- **Edge Functions** (6: `extract-invoice`, `gemini-enrich`, `razorpay-link` / `-paylink` / `-webhook`, `whatsapp-send`) → `supabase functions deploy` against the new ref.
- **Secrets** (9: `GEMINI_API_KEY`, `OCR_API_KEY`, `OCR_MODEL`, `ENRICH_MODEL`, `RAZORPAY_KEY_ID` / `_SECRET` / `_WEBHOOK_SECRET`, `WHATSAPP_TOKEN` / `_PHONE_NUMBER_ID`) → `supabase secrets set …`. **Write-only** — you cannot read them back from the old project; pull values from your `.env` / password-manager / the providers. (`SUPABASE_*` are auto-injected per project — don't set them.)
- **Auth providers** → re-enable Google + paste the same Client ID/Secret on the new project; set Site + Redirect URLs to the app origin. Skipping it gives `"provider is not enabled"`. Email/password just works (hashes are in `auth.users`).
- **External webhooks** → repoint to the new function URLs (Razorpay webhook → `https://<new-ref>.supabase.co/functions/v1/razorpay-webhook`).
- **App env + CLI** → Vercel `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` → the new project, then **redeploy** (build-time vars); `supabase link --project-ref <new>`; rebuild the Go migrator if it embeds the URL/key.

**Verify before reopening counters:** a known user logs in (auth migrated); a known org's trial balance nets to 0 and item/batch/bill counts match the source; RLS still denies cross-org; `create_sales_invoice` posts end-to-end; `whatsapp-send` responds; region reads `ap-south-1`.

**Cutover & rollback:** keep the Sydney project **paused** for ~a week; if anything is wrong, repoint `VITE_SUPABASE_URL` back to it. Delete Sydney only after verification + the rollback window. Re-enable **PITR** on the new project (ties to SALT-134).

**Gotchas (the actual walls hit during the Sydney→Mumbai run):** ① `pg_dump` must be **≥ the server major version** (Salt = PG17; a v16 client aborts with "server version mismatch"). ② Whole-schema `auth`/`storage` dumps hit *permission denied* on internal tables (`buckets_vectors`, `schema_migrations`) → dump specific tables instead. ③ Storage **files** don't move via `pg_dump` — copy them through the Storage API. ④ Functions / secrets / auth-providers / external-webhooks are **project config, not DB** — redo each (and secrets are write-only). ⑤ Both projects bill concurrently during the window.

**Inspector-ready audit trail.** The append-only audit log UI exists (**SALT-092**, done; viewable at `/settings/audit`, see [App.tsx](../architecture/screens-routing.md)) and a data-export path exists (**SALT-093**). The **DB-level capture triggers + append-only lockdown** that record who/what/when on sales / purchases / payments / ledgers are **SALT-171** (`database`, todo) — that is the database module's work, not infra; this page just records the dependency. Once triggers land, the `/settings/audit` viewer + export is the inspector surface.

## Scalability — load test to PRD scale (SALT-138)

**PRD targets:** 50k items · 1M bills/year · 100 shops, meeting the **SALT-133** latency targets:
- local save **< 200 ms**, 10k-item list render **< 500 ms**, reports **< 5 s**.

**Method (documented; execution needs an account-owner step).**
1. **Provision a non-prod Supabase project** on the same plan, India region, with `supabase/migrations/0001`–`0031` applied.
2. **Seed to scale:** one org, 100 `shops`, 50k `items` + batches, ~1M `sales_invoices`/`sale_lines` spread across a year and the shops, plus proportional `stock_movements` and `ledger_entries`. (A seed generator can be written as a follow-up infra task; it must post through the real RPCs or insert pre-balanced rows so `v_*` views stay consistent.)
3. **Drive the hot paths** as an **authenticated** member (anon-key timing against prod is blocked by RLS — a seeded, authenticated test env is required): catalog/substitute search, `create_sales_invoice` save, and the heaviest report (`v_*` aggregates over a year). Record p50/p95 against the SALT-133 targets.
4. Tune with indexes / pagination (`fetchAllPaged` already bounds report reads) where a target is missed.

**Status:** blocked on a seeded, authenticated non-prod environment (account-owner provisioning). The method + targets are recorded here so the run is turnkey once that exists.

## Action items

| # | Action | Owner | Ticket | Blocks |
|---|---|---|---|---|
| 1 | Enable PITR + confirm daily-backup retention on the Supabase project | **Account owner** (dashboard) | SALT-134 | full reliability sign-off |
| 2 | Confirm the project region is an India region (`ap-south-1`); migrate if not | **Account owner** (dashboard) | SALT-137 | residency compliance |
| 3 | Provision + seed an authenticated non-prod project to PRD scale, then run the load test | **Account owner** + infra | SALT-138 | scalability sign-off |
| 4 | GDPR/DPDP export + erase RPC (`export_party_pii` / `erase_party_pii`) + owner UI | **database** module | SALT-188 | SALT-136 erase |
| 5 | Audit-capture triggers + append-only lockdown on financial tables | **database** module | SALT-171 | SALT-137 audit |

Infra has delivered the documentation, runbooks, and method above + the no-PII-logs verification + the at-rest/transit/RLS posture. The remaining items are account-owner dashboard actions or other modules' code, tracked by the tickets above.

## Related
- [stack](stack.md) · [security-rls](security-rls.md) · [data-model](data-model.md) · [../product/roadmap](../product/roadmap.md)
