---
type: decision
updated: 2026-06-01
tags: [offline-first, sync, architecture, billing, supabase]
---

# 0017 — Offline-first substrate: a custom local write-queue + read-cache (not a sync engine)

## Status
Accepted (chosen with the user, 2026-06-01) for **SALT-135**, Phase 1. As the *starting* substrate this supersedes the PRD's ElectricSQL/Yjs/shop-local-server recommendation (§6.2); see [0002](0002-stack-divergence-from-prd.md). Phase 2 (multi-counter) re-opens the sync-engine question — [SALT-203].

## Context
"Bill through an outage" is the PRD's strategic wedge for tier-2/3 India on unreliable internet, and the biggest unbuilt gap ([roadmap](../product/roadmap.md)). Two facts about the **as-built** app decide the substrate:

1. **Every write is a security-definer Postgres RPC.** `create_sales_invoice`, `record_payment`, `receive_purchase`, `adjust_stock`, `create_debit_note`, … (19 RPCs). They post **double-entry**, move **stock**, allocate the **gap-free FY invoice number**, and enforce the **Schedule-H1 gate** — all server-side. The client makes **no direct table writes**.
2. **There is no offline infrastructure today.** No service worker / PWA / IndexedDB; the Zustand stores (`bill`, `catalog`, `ui`) are not even persisted. Greenfield.

Off-the-shelf sync engines (ElectricSQL, PowerSync) replicate **table rows**, not RPC calls. They suit a read replica, but for Salt's RPC writes they force a bad choice: **re-implement all posting logic client-side** (double-entry, stock, invoice series, H1 — a large, divergence-prone duplication of the server) **or still hand-build a write queue** on top of them. Yjs is a CRDT for collaborative documents — the wrong shape for transactional posting.

## Decision
Build a **custom client offline layer** scoped to the counter, in two halves:

- **Read cache** — an IndexedDB snapshot of the counter's working set (`items`, `batches`, `parties`, shop + settings), seeded/refreshed while online and served while offline. Read-mostly data, so a cache (not live sync) suffices for billing. → [SALT-204]
- **Write queue** — a durable (IndexedDB) FIFO of **RPC intents**: the write RPC's name + args, each stamped with a **client-generated idempotency key**. Offline, the bill is committed to the queue and local state updates optimistically; on reconnect the queue drains in order by calling the real RPCs **idempotently** (a replay cannot double-post). → [SALT-200]

Supporting decisions:
- **Idempotency keys on the write RPCs** so replay is safe — precedents: client-UUID linking [0007](0007-client-side-uuid-generation.md), document-import idempotency [0011](0011-document-import-idempotency-key.md). → [SALT-201]
- **Provisional invoice numbers** offline; the server allocates the real gap-free FY `invoice_no` (the `invoice_series` RPC) on sync, and the printed copy is marked provisional until then. → [SALT-202]
- **Stock at the edge:** allow the offline sale (the counter physically holds the stock) and reconcile on sync; the oversell guard (SALT-181) + Phase-2 conflict resolution cover multi-counter contention.

## Alternatives rejected (the spike)
| Option | Why not (for Phase 1) |
|---|---|
| **PowerSync** (managed Postgres↔SQLite) | Best-in-class row sync + a Supabase integration, but row-sync ≠ RPC posting → still need a custom write path; adds recurring cost + coupling. Revisit for Phase-2 read-sync. |
| **ElectricSQL / self-hosted Electric** | Same row-vs-RPC mismatch; self-host adds ops. |
| **Yjs** | Collaborative-document CRDT, not a transactional/posting substrate. |
| **Shop-local server now** (PRD §6.2) | Highest build + ops; only pays off for multi-counter LAN failover → Phase 2. |

## Consequences / phasing
- **Phase 1 — single-counter 12h offline (committed):** read-cache [SALT-204] + write-queue [SALT-200] + RPC idempotency [SALT-201] + offline-aware counter with provisional invoice no [SALT-202]. Connectivity awareness (`useOnlineStatus` + `OfflineBanner`) already shipped (PR #62).
- **Phase 2 — multi-counter (deferred, [SALT-203]):** shop-local server **or** a managed sync engine for live cross-counter stock + parked-bill sync + conflict resolution (stock, invoice series). The PowerSync/Electric/self-host question re-opens here, informed by Phase-1.
- **Risks:** cache staleness (price/stock drift) → bound the offline window + stamp "as of <time>"; queue durability + replay ordering; idempotency correctness; invoice-number gaps. Tracked in the sub-tickets.

## Links
- Design detail + comparison: [../architecture/offline-first](../architecture/offline-first.md)
- [0002 stack divergence](0002-stack-divergence-from-prd.md) · [0007 client UUID](0007-client-side-uuid-generation.md) · [0011 doc idempotency](0011-document-import-idempotency-key.md) · [realtime](../architecture/realtime.md) · [roadmap](../product/roadmap.md)
