---
type: architecture
updated: 2026-06-02
tags: [infra, ci, build, offline, ops, migrations]
---

# Infra module

Infra is not a feature module — it has **no screens or UI**. It owns the **root configs and cross-cutting plumbing**: CI/CD, the build + route code-splitting, migration hygiene, the offline-first *read* primitive, and the ops/NFR posture. By design it stays out of feature modules' source and files tickets for work that belongs to them (e.g. SALT-186, 188, 207). 7 tickets shipped; this page synthesises them — deeper pages are linked per section.

## Build, CI & the nav↔route guard (SALT-142)

- **Build:** `cd apps/web && pnpm lint && pnpm build` (`tsc -b` then Vite); Turborepo tasks (`turbo.json`). CI is the GitHub Actions job **"Lint, Typecheck & Build"** on PRs to `main`, plus Vercel preview deploys. See [stack](stack.md).
- **`apps/web/scripts/check-nav.mjs`** — a CI guard enforcing the `navConfig.ts` ↔ `App.tsx` invariant: every nav node marked `built: true` must carry a `path`, and every nav `path` must resolve to a real `<Route>`. Wired as the CI step **"Nav route invariant"** and `pnpm --filter web check:nav`. This turns "per-module on ship" (add the route + flip `built: true`) into an automated gate instead of a convention that silently drifts. Orphan routes (`/x/:id`, sub-flows, `/setup`) are intentionally allowed. Detail → [screens-routing](screens-routing.md).
- **Key files:** `.github/workflows/ci.yml`, `apps/web/scripts/check-nav.mjs`, `turbo.json`, root `vercel.json`.

## Migration hygiene (SALT-140)

Promoted the target-model SQL from `supabase/proposed/0014–0024` into `supabase/migrations/` (a git-mv rename with the `DRAFT / DO NOT RUN` banner stripped — executable SQL byte-identical, since it was already applied to the live DB on 2026-05-31). The migration history is now a contiguous, runnable `0001–0024` + `0025+` that matches the live DB; `full_data_model.sql` stays in `proposed/` as the one-shot apply script. Migrations are **run by the user** in the Supabase SQL editor — never auto-applied. Detail → [data-model](data-model.md) · [proposed-data-model](proposed-data-model.md) · [decisions/0009](../decisions/0009-target-data-model.md). **Gotcha:** committed ≠ applied — probe the live DB before any schema work.

## Offline-first substrate (SALT-135 / ADR 0017; read-cache SALT-204; write-queue SALT-200 superseded)

The decision — a **custom local write-queue + read-cache, not a sync engine** — is [decisions/0017](../decisions/0017-offline-first-substrate.md) (design: [offline-first](offline-first.md)). The crux: every write is a security-definer RPC (`create_sales_invoice` etc.), so a row-sync engine (ElectricSQL/PowerSync) does not fit the write path. Per the PRD's offline wedge (`salt-prd-v0.3.md` §6.2).

- **Read-cache — infra-owned and live: `apps/web/src/lib/offline/cache.ts`** (SALT-204). A best-effort IndexedDB kv cache (`cacheKey` / `cacheGet` / `cachePut` + `formatStaleness`; every op resolves, never throws). A consumer caches its working set on each successful online load and serves it offline with a `cachedAt` staleness hint instead of failing. **Adopted by** the catalogue (`store/catalog.ts`), parties (`PartiesPage`, SALT-207), and the counter customer picker (`CustomerPicker`, SALT-215) — all keyed by `cacheKey(scope, orgId)`.
- **Write path — consolidated away from infra:** the SALT-200 spike (`lib/offline/writeQueue.ts`) turned out to duplicate a parallel **Outbox** and was **removed by SALT-210**; its one unique feature (poison-parking after `maxAttempts`) was folded into the shared `lib/offline.ts` + `lib/outbox.ts` (online-aware auto-flush, `useOutbox` / `usePendingWrites`), which billing's `useCheckout` enqueues to when offline (SALT-205). Server-side replay safety is `supabase/migrations/0045_idempotency_keys.sql` (SALT-201). So the **live offline write path is not infra-owned** today — infra owns the read-cache half.
- **Connectivity awareness:** `lib/useOnlineStatus.ts` + the app-wide `OfflineBanner` (shipped earlier, PR #62).

## Ops & NFR posture (SALT-136 done; SALT-134/137/138)

[operations.md](operations.md) documents the non-functional posture (Salt runs entirely on Supabase, so most baseline is inherited): **reliability** (backup/PITR model + a restore runbook), **security** (at-rest AES-256 / TLS / per-org RLS + the verified no-plaintext-PII-logs; GDPR export/erase split to SALT-188), **compliance** (India residency; audit-capture triggers = SALT-171 / `0038_audit_capture.sql`), **scalability** (a turnkey load-test method). The remaining items are **account-owner dashboard actions** — enable PITR (134), confirm the `ap-south-1` region (137), provision a seeded load-test project (138).

## Wiki maintenance

Infra reconciled the stale roadmap against the as-built board (SALT-141 → [roadmap](../product/roadmap.md)). Note: `index.md` and `log.md` are reconciled by the **wiki lane**, so infra PRs leave them alone.

## Decisions & gotchas

- **`CLAUDE.md` edits are blocked** by the auto-mode classifier as self-modification — put conventions in the wiki or a script header, not the startup contract.
- **Migrations are user-run; committed ≠ applied** — always probe the live DB.
- **Heavy parallel-lane churn:** SALT-200's write-queue was superseded mid-flight (SALT-210). Verify the live tree before relying on or documenting an infra artifact.
- **Stay out of feature-module source** — cross-cutting needs are filed as tickets, not edited in place.

## Current state vs planned

- **Shipped (7):** SALT-135 (spike + ADR 0017), 136 (security posture), 140 (migrations promotion), 141 (roadmap refresh), 142 (nav guard), 200 (write-queue → consolidated into the Outbox), 204 (read-cache, widely adopted).
- **Open / blocked:** SALT-134 / 137 / 138 (account-owner actions); offline Phase-1 capstone lives in billing (SALT-202 / 205); Phase-2 multi-counter is [SALT-203] (local-server failover + cross-counter conflict resolution).

## Related
- [stack](stack.md) · [screens-routing](screens-routing.md) · [operations](operations.md) · [offline-first](offline-first.md) · [decisions/0017](../decisions/0017-offline-first-substrate.md) · [decisions/0009](../decisions/0009-target-data-model.md)
