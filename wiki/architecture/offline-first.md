---
type: architecture
updated: 2026-06-01
tags: [offline-first, sync, indexeddb, billing, write-queue]
---

# Offline-first substrate (spike + design)

The plan to make the counter **bill through an internet outage** — the PRD's strategic wedge. Decision recorded in [../decisions/0017-offline-first-substrate](../decisions/0017-offline-first-substrate.md); this page is the engineering design + the spike that backs it. Tracking epic: **SALT-135**.

## The spike — why a custom layer, not a sync engine

Two as-built facts dominate the choice:

1. **Writes are 100% security-definer RPCs.** A sale is not an `insert` — it is `create_sales_invoice(...)`, which posts double-entry to `ledger_entries`, moves `stock_movements` + `batches.qty`, allocates a gap-free FY `invoice_no`, and enforces the H1 gate. Same for `record_payment`, `receive_purchase`, `create_debit_note`, … (19 RPCs, **zero** direct table writes from the client).
2. **No offline infra exists.** No service worker / PWA / IndexedDB; Zustand stores aren't persisted. Greenfield.

| Substrate | Read path | Write path (the problem) | Verdict |
|---|---|---|---|
| **Custom queue + cache** | IndexedDB cache, seed-when-online | Queue RPC **intents**, replay idempotently on reconnect | ✅ **Phase 1** — fits the RPC model, $0, no new infra |
| PowerSync (managed) | ✅ great row sync | Syncs rows, not RPCs → still custom write path; + cost/coupling | Phase-2 candidate |
| ElectricSQL / self-host | ✅ row sync | Same row≠RPC mismatch; + ops | Phase-2 candidate |
| Yjs | doc CRDT | not transactional posting | ✗ wrong tool |
| Shop-local server (PRD §6.2) | mirror PG↔SQLite | native multi-counter LAN | Phase-2 (highest ops) |

A row-sync engine would force re-implementing the posting logic client-side (huge, divergence-prone) **or** building a write queue anyway — so for Phase 1 the queue is the core either way. Build just the queue.

## Design — Phase 1 (single counter, 12h offline)

```
            online                         offline
 reads  →  Supabase  ──seed──▶  IndexedDB cache  ──▶  counter (search, parties, stock)
 writes →  RPC                  IndexedDB queue ◀──   counter (save bill → enqueue intent)
                         reconnect: drain queue → real RPCs (idempotent) → reconcile
```

### Read cache — [SALT-204]
- IndexedDB stores for the counter working set: `items`, `batches`, `parties`, active `shop` + settings (read-mostly).
- Seed on login / when online; refresh on a bounded cadence. Catalog + party reads fall back to the cache when [`useOnlineStatus`](realtime.md) reports offline.
- Surface **"data as of HH:MM"** so the operator knows the staleness; bound the supported offline window.
- **Status — catalogue cache built (SALT-204):** `lib/offline/cache.ts` (a best-effort IndexedDB kv store; never throws) + `store/catalog.ts` now caches the mapped working set on each successful online load and serves it offline instead of the demo seed, exposing `cachedAt` for the staleness hint. Party reads are scattered across feature modules (no central fetch) → adopting the cache there is split to **SALT-207**.

### Write queue — [SALT-200]
- Durable (IndexedDB) FIFO of intents `{ rpc, args, idempotencyKey, enqueuedAt }`.
- Offline save → `enqueue` + optimistic local state (the bill shows as **queued**).
- On reconnect → `drain()` in order, calling the real RPC per intent; **at-least-once** delivery made safe by the idempotency key. Failures retry / park with a surfaced error — never a silent drop, never a head-of-line deadlock.
- Exposes sync status (queued / syncing / synced) for the UI.
- **Status — shipped + wired (SALT-100 + SALT-205; consolidated SALT-210):** the write-queue is **`lib/offline.ts`** (pure `Outbox` + injectable `IndexedDbOutboxStore`/`InMemoryOutboxStore`) + **`lib/outbox.ts`** (browser singleton + `useOutbox`/`usePendingWrites`, online-aware auto-flush). Consumers `outbox.register(kind, handler)` + `outbox.enqueue(kind, payload)`; billing's `useCheckout` registers `create_sales_invoice` and enqueues when offline (SALT-205), surfacing `usePendingWrites()` as an "N to sync" badge. The FIFO drain **stops** on a transient failure (order kept for retry) and **parks** a poison record after `maxAttempts` (no head-of-line deadlock); `pending()` excludes parked so the badge clears. The record `id` is the client idempotency key; server-side honouring is **SALT-201**. A parallel spike `lib/offline/writeQueue.ts` (SALT-200) was the redundant duplicate and was **removed** by SALT-210 — its one unique feature, poison-parking, folded into `Outbox.flush(maxAttempts)`. (`lib/offline/cache.ts`, the read-cache half, is unrelated and stays.)

### Idempotent replay — [SALT-201]
- The write RPCs take `p_idempotency_key uuid`; a duplicate key **returns the original document id** instead of re-posting (no second double-entry / stock move / invoice number). Optional + backward-compatible. Mirrors the document-import idempotency ([0011](../decisions/0011-document-import-idempotency-key.md)).

### Invoice numbers + stock at the edge — [SALT-202]
- Offline bills carry a **provisional** handle; the server assigns the real gap-free FY `invoice_no` (the `invoice_series` RPC) when the intent replays. Print marks the copy **provisional / unsynced** until reconciled.
- Stock: allow the sale offline (the counter holds the physical stock); reconcile on sync. Cross-counter contention is Phase 2.

## Phase 2 — multi-counter (deferred, [SALT-203])
Live cross-counter stock + parked-bill sync + conflict resolution (oversell, invoice-series collisions) + local-server failover. Re-opens the substrate choice (PowerSync / Electric / shop-local server), now informed by Phase-1. Builds on the oversell guard (SALT-181) and the multi-counter conflict ticket (SALT-102).

## Open questions
- Cache eviction + max offline window (storage pressure on low-end shop PCs).
- Queue ordering across **dependent** intents (e.g. a credit note against an offline-created invoice still in the queue).
- Whether to add a service worker / PWA shell so the app *loads* offline (separate from data) — likely a small follow-on.

## Related
- [../decisions/0017-offline-first-substrate](../decisions/0017-offline-first-substrate.md) · [realtime](realtime.md) · [billing-screen](billing-screen.md) · [../product/roadmap](../product/roadmap.md) · [../decisions/0002-stack-divergence-from-prd](../decisions/0002-stack-divergence-from-prd.md)
