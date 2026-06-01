---
type: decision
updated: 2026-06-01
tags: [offline, realtime, architecture, billing]
---

# 0017 — Offline-first via a local write outbox (not ElectricSQL)

**Status:** accepted · implements SALT-100 (substrate) · supersedes the PRD §6.2 offline design (with [0002](0002-stack-divergence-from-prd.md))

## Context

Salt's strategic wedge is "bill through an outage, sync on reconnect" — shop internet in tier-2/3 India is unreliable, and a cashier must never be blocked from completing a sale. The PRD (§6.2) specifies **ElectricSQL** (Postgres↔SQLite sync) + a **shop-local server** + **Yjs**. As-built, the app is an online-only Supabase SPA; the awareness layer (`useOnlineStatus` + `OfflineBanner`, SALT-135) warns the user but writes still fail offline. This ADR picks the mechanism for the write path.

## Decision

Adopt a **local write outbox** on the existing Supabase stack, not ElectricSQL:

- Mutations that must survive an outage are **enqueued** to a durable local queue (**IndexedDB**, survives reloads/crashes) and **replayed FIFO** to the existing RPCs when connectivity returns.
- The queue record `id` is a **client-generated UUID** used as the **idempotency key**, so replays are exactly-once when the server honours the key (at-least-once with on-success de-dup otherwise).
- Built as a **pure, decoupled substrate** (`lib/offline.ts` — `Outbox` + storage interface, no React/Supabase) with a browser singleton + online-aware auto-flush + reactive pending count (`lib/outbox.ts`). Consumers `register(kind, handler)` and `enqueue(kind, payload)`; they own *what* gets queued.

## Rationale

- **Fits the stack, zero new infra.** ElectricSQL needs a sync service, Postgres logical replication, and an embedded SQLite mirror per client — a major operational and RLS/auth-integration commitment. The outbox is ~200 lines of client code over the RPCs Salt already has (`create_sales_invoice`, `record_payment`, `receive_purchase`). Same reasoning as ADR [0002](0002-stack-divergence-from-prd.md) (prefer the Supabase-native path) and the Realtime substrate ([realtime.md](../architecture/realtime.md)).
- **Right scope for the actual need.** The hard requirement is *offline writes* (the sale must complete), not full bidirectional CRDT replication of the whole DB. Reads are already cacheable; the outbox solves the write path directly.
- **Idempotency is already a house pattern** (ADR [0011](0011-document-import-idempotency-key.md)) — the client-key approach is consistent.
- **Incremental + low-risk.** Each module adopts the outbox for its own mutations independently; nothing is rewritten.

## Consequences

- **Server idempotency is the follow-up that makes it exactly-once.** The RPCs should accept the client key and no-op on replay. Until then, delivery is at-least-once (the outbox removes on success, so the only double-send window is a crash between RPC-commit and local-remove).
- **Conflict policy is last-writer-wins per mutation, ordered by the queue.** Combined with the server-side atomic stock guard (SALT-181) and live stock (SALT-179), an offline sale that would oversell is rejected on replay and surfaced to the user — acceptable for v1 (offline last-unit races are rare).
- **SALT-103 (shop-local server) is de-scoped to "optional, later".** Its value was LAN-local sync latency + an offline gateway; the outbox covers offline resilience and Supabase Realtime covers online sync (<1s). Revisit only if a single shop has many counters on one LAN needing sub-network latency.
- **No multi-tab leader election in v1.** Two tabs share one IndexedDB queue; concurrent flushes are guarded by FIFO + remove-on-success but could double-attempt one record (idempotency key covers it).

## Alternatives considered

- **ElectricSQL (PRD).** Most capable (real local-first reads+writes) but heaviest; deferred, not rejected forever — if Salt later needs full offline reads across the catalogue/ledgers, revisit.
- **Service Worker + Background Sync.** Browser-native replay, but flaky across browsers, hard to test, and opaque to the app's pending-count UI. The explicit outbox is testable and observable.
- **Supabase client offline mode.** Not a first-class feature; would amount to building this anyway.

## What was built (SALT-100)

`lib/offline.ts` (pure `Outbox` + `InMemoryOutboxStore`/`IndexedDbOutboxStore`, smoke-tested 14/14) and `lib/outbox.ts` (singleton + `useOutbox`/`usePendingWrites`). Adoption in the sales write path is handed off to **billing** (it owns the checkout flow). See [../architecture/realtime.md](../architecture/realtime.md).
