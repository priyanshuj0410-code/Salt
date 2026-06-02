---
type: architecture
updated: 2026-06-02
tags: [realtime, multi-counter, offline, activity, approvals, presence, supabase]
---

# Real-time & offline (multi-counter substrate)

The PRD's strategic wedge (§7, Phase 5) is **offline-first + real-time multi-counter** — the thing no competitor (Marg/Tally/eVitalRx) has. As-built it is **not** the PRD's self-hosted Yjs/ElectricSQL stack; it rides **Supabase Realtime** (Postgres Changes + Presence) + a **client-side write outbox**. This module owns the shared substrate (`lib/realtime.ts`, `lib/offline.ts`) and the live shop surfaces built on it; the *consuming* features (live stock in the counter, parked bills, the offline checkout) live in other modules and adopt the substrate via handoff tickets.

Seven tickets shipped: **SALT-100** (offline outbox), **SALT-101** (presence), **SALT-102** (multi-counter conflict resolution), **SALT-104** (activity feed), **SALT-105** (internal messages), **SALT-106** (manager approvals), **SALT-210** (write-queue consolidation).

## Tech choice — Supabase Realtime + an outbox, not Yjs/ElectricSQL

> **PRD-vs-as-built divergence (flagged), per ADR [0002](../decisions/0002-stack-divergence-from-prd.md) + [0017](../decisions/0017-offline-first-approach.md).** The backend is already Supabase, so **Realtime** (server-authoritative live features) and a **local write outbox** (offline writes) are zero new infra, RLS-aware, and ship today. ElectricSQL/Yjs (full CRDT local-first) were deferred, not adopted — the real need is *offline writes* + *live read fan-out*, not whole-DB replication.

## Screens & flows

### `/activity` — Activity feed (SALT-104)

`components/activity/ActivityPage.tsx` · nav `g v` · **owner + cashier** (cross-counter awareness is the point).

| Feature | What it does |
|---|---|
| **Live feed** | Every sale / payment / GRN across all counters, newest-first. 200-row initial fetch + live prepend (de-duped, capped 500) via `subscribeActivity`. |
| **Filters** | By kind (sales/purchases/payments), today-only, free-text (party / counter / ref). Client-side over the fetched window. |
| **Live indicator** | A `Dot` that flips connecting → live on channel `SUBSCRIBED`. |
| **Open a thread** | Click any event → a `Dialog` with that entity's `<MessageThread>` (SALT-105) — so messaging is usable without touching other modules. |

### `/approvals` — Manager approvals (SALT-106)

`components/approvals/ApprovalsPage.tsx` · nav `g o` · **owner + cashier**.

| Feature | What it does |
|---|---|
| **Pending inbox** | Live list of open requests; **Approve/Reject** for owners, **Cancel** for the requester. Updates live (INSERT + UPDATE) via `subscribeApprovals`. |
| **Decided history** | Recent approved/rejected/cancelled, with decider + time. |
| **Raise request** | A dialog (kind chips + summary + optional amount) any member can use — so the raise → decide loop is demoable in-lane. |

### Embedded primitives (used across the app)

- **`<MessageThread entityType entityId />`** (`components/messages/`) — a reusable live note/chat thread for any entity; composer + own-vs-other bubbles. Embedded in `/activity`; per-screen embedding on bill/party/item handed off (SALT-160/161/162).
- **`<OnlineCounters />`** (`components/presence/`) — "who is at the counters" avatars + count; shown in the `/activity` and `/approvals` headers.

## The realtime substrate — `lib/realtime.ts`

One reusable primitive: a **per-org Postgres-changes channel**, RLS-enforced (the subscriber only receives rows it can `select`).

| Export | Use |
|---|---|
| `subscribeTableInserts<T>({ channel, table, filter?, onInsert, onStatus? })` | INSERT-only fan-out (activity feed, messages). |
| `subscribeTableChanges<T>({ channel, table, filter?, event?, onChange, onStatus? })` | INSERT **+ UPDATE** (+ DELETE) — for state that changes after creation (an approval `pending → approved`; live stock). |

Both return an unsubscribe fn and no-op when `supabase` is null. **Presence** is separate (ephemeral, not a table) — `lib/presence.ts → usePresence(orgId, userId, name, role)` wraps a Supabase Presence channel and returns the de-duplicated online members.

> **Publication requirement (gotcha).** `postgres_changes` only fires for tables in the `supabase_realtime` publication. Each migration here runs `alter publication supabase_realtime add table …` (wrapped in a `DO`/exception block so a re-run or non-Supabase Postgres is a no-op). A subscription to a table **not** in the publication is silently dormant — exactly the state of live-stock until SALT-217 publishes `batches`.

## Data model

All three tables are org-scoped (`org_id → orgs ON DELETE CASCADE`), carry `created_at timestamptz default now()`, have standard `is_member(org_id)` RLS, and are in the `supabase_realtime` publication.

### `activity_events` — `0028_activity_events.sql`

Append-only shop event log. Written **server-side by triggers**, never by app code.

| Column | Notes |
|---|---|
| `kind` | `sale` / `purchase` / `payment_in` / `payment_out` |
| `entity_type`, `entity_id` | Source table + row (deep-link target) |
| `actor_id`, `actor_name` | Who acted — denormalized so the realtime payload needs no join |
| `party_id`, `party_name` | Customer/vendor, denormalized |
| `title`, `amount_paise`, `ref` | Human label · money · invoice_no/grn_no/reference |
| `meta` | `jsonb`, extensible |

**`tg_log_activity()`** — one generic `AFTER INSERT` trigger, parameterized via `TG_ARGV(kind, entity_type)`, on `sales_invoices` / `payments` / `purchases`. Reads `to_jsonb(NEW)` and extracts fields with **NULL-safe `->>` over candidate column names** (so it cannot fail on a column a table lacks — only `id` + `org_id` are required); `actor = coalesce(created_by, auth.uid())`; skips imported rows (`posts_effects = 'false'`); wrapped `exception when others → return NEW` so logging can never break the business write. Index `(org_id, created_at desc)`.

### `entity_messages` — `0029_entity_messages.sql`

Internal staff notes/chat. A thread is `(entity_type, entity_id)`.

| Column | Notes |
|---|---|
| `entity_type`, `entity_id` | The thread target (`sales_invoice` / `customer` / `item` / …) |
| `body` | The message |
| `author_id`, `author_name` | Stamped server-side (see trigger) |

**`tg_stamp_message_author()`** (`before insert`) — `author_id := coalesce(author_id, auth.uid())` (un-spoofable) and resolves `author_name` from `profiles`. Index `(org_id, entity_type, entity_id, created_at)`.

### `approval_requests` — `0030_approval_requests.sql`

Cross-device approvals.

| Column | Notes |
|---|---|
| `kind` | `discount_override` / `credit_override` / `price_override` / `return_auth` / `void_bill` / `other` |
| `summary`, `amount_paise`, `context` (`jsonb`) | What needs sign-off + entity refs |
| `status` | `pending` / `approved` / `rejected` / `cancelled` |
| `requested_by(_name)`, `decided_by(_name)`, `decided_at` | Stamped server-side |

**Security model:** `is_member` for **select** + member **insert** (a `before insert` trigger stamps the requester and pins `status='pending'` — no self-approve). **No client UPDATE policy** — status is written only by two `security definer` RPCs: **`decide_approval_request(p_id, p_approved)`** (owner-only, enforced via `memberships.role`) and **`cancel_approval_request(p_id)`** (requester-only). Index `(org_id, status, created_at desc)`.

### Offline outbox — **client-side IndexedDB, no Postgres table** (SALT-100)

Durable queue in IndexedDB (`salt-offline` DB, `outbox` store, `keyPath: "id"`). Record: `{ id (client UUID = idempotency key), kind, payload, createdAt, attempts, status: "pending"|"parked", lastError }`.

## Offline-first write outbox — `lib/offline.ts` + `lib/outbox.ts` (SALT-100, SALT-210)

"Bill through an outage, sync on reconnect." The awareness layer (`useOnlineStatus` + `OfflineBanner`, SALT-135) only *warns*; this is the write path.

- **`lib/offline.ts`** (pure — no React/Supabase imports, so it is smoke-testable): an `Outbox` that `enqueue`s mutations to an injectable `OutboxStore` (`IndexedDbOutboxStore` durable / `InMemoryOutboxStore` for tests) and `flush()`es them **FIFO, stop-on-transient-failure**. A record that fails `maxAttempts` (default 5) is **parked** (`status='parked'`, skipped) so one poison write never dead-locks the queue head (added in SALT-210, the consolidation that retired a duplicate `lib/offline/writeQueue.ts`). `pending()` excludes parked.
- **`lib/outbox.ts`** — the browser singleton + `useOutbox()` / `usePendingWrites()` with **online-aware auto-flush** (subscribes to `useOnlineStatus`).
- **Decoupled:** consumers `outbox.register(kind, handler)` + `outbox.enqueue(kind, payload)`. Billing wired the sales path (SALT-205): `useCheckout` registers `create_sales_invoice` and enqueues when offline, printing a provisional `OFFLINE-xxxx` ref; the queue auto-flushes on reconnect.

## Multi-counter conflict resolution (SALT-102 — done)

Closed by two halves that both landed:

1. **Server guarantee (SALT-181, billing):** `create_sales_invoice` decrements stock atomically — `update batches set qty = qty - n where id = :id and qty >= n` then `if not found then raise 'insufficient stock'`. Two counters racing the last unit → exactly one succeeds; the other gets a recoverable error. Active regardless of Realtime.
2. **Collision-reducing UX (SALT-179, billing):** live stock on the counter rides `subscribeTableChanges` on `batches` → patches the in-memory catalogue, so FEFO/stock-cap reflect other counters within ~1s. Code merged; **fully lights up when SALT-217 publishes `batches`** to the publication.

## Key files

| File | Role |
|---|---|
| `lib/realtime.ts` | The substrate: `subscribeTableInserts` / `subscribeTableChanges` |
| `lib/activity.ts` · `components/activity/ActivityPage.tsx` | Activity feed data + screen |
| `lib/messages.ts` · `components/messages/MessageThread.tsx` | Message threads data + reusable UI |
| `lib/approvals.ts` · `components/approvals/ApprovalsPage.tsx` | Approvals data/RPC wrappers + inbox |
| `lib/presence.ts` · `components/presence/OnlineCounters.tsx` | Presence hook + indicator |
| `lib/offline.ts` · `lib/outbox.ts` | Offline write outbox + React bindings |
| `supabase/migrations/0028–0030` | activity_events · entity_messages · approval_requests |

## Key decisions & gotchas

- **Capture via DB triggers, not app edits.** The activity feed reads three other modules' tables but emits via triggers in the realtime migration — so the cross-cutting feed never touches billing/payments/GRN code, and *any* writer (UI, RPC, import) is captured.
- **Schema-resilient triggers.** `to_jsonb(NEW)` + NULL-safe `->>` over candidate columns means the migration cannot fail on a missing column — robust against the live schema drifting from the older `data-model.md` snapshot.
- **Denormalized realtime payloads.** Names (actor/party/author) are resolved in-trigger so a `postgres_changes` row renders with no extra round-trip.
- **Writes go through SECURITY DEFINER RPCs, never client UPDATE** (approvals) — the authoritative state transitions are server-guarded (owner-only decide), not enforced only in the UI.
- **Idempotency key = the outbox record id.** Replay is at-least-once today; exactly-once needs the RPCs to honour the key (SALT-201, DB lane).
- **Publication is easy to forget** — a subscription to an unpublished table is silently dormant (the live-stock-awaiting-SALT-217 case).

## Current state vs planned

| Feature | Ticket | Status |
|---|---|---|
| Activity feed (`/activity`) | SALT-104 | ✅ Shipped |
| Internal messages (`<MessageThread>`) | SALT-105 | ✅ Shipped; per-screen embeds → SALT-160/161/162 |
| Manager approvals (`/approvals`) | SALT-106 | ✅ Shipped; counter gates SALT-175 ✅ (billing) |
| Counter presence | SALT-101 | ✅ Shipped (presence); global-shell placement pending |
| Offline write outbox | SALT-100 | ✅ Shipped; checkout adoption SALT-205 ✅ (billing) |
| Write-queue consolidation + poison-parking | SALT-210 | ✅ Shipped |
| Multi-counter conflict resolution | SALT-102 | ✅ Done (SALT-181 guard + SALT-179 live stock) |
| Live stock / parked-bill sync on counter | SALT-179 / 180 | ✅ Shipped (billing); live stock activates on SALT-217 |
| Publish `batches`/`stock_movements` to Realtime | SALT-217 | ⏳ DB lane — un-dormants live stock |
| Server idempotency for replay (exactly-once) | SALT-201 | ⏳ DB lane |
| Shop-local server | SALT-103 | ⛔ De-scoped to optional (ADR 0017); revisit only for true LAN latency / ElectricSQL |

## Related pages
- [decisions/0002 — stack divergence from PRD](../decisions/0002-stack-divergence-from-prd.md)
- [decisions/0017 — offline-first via a local write outbox](../decisions/0017-offline-first-approach.md)
- [product/roadmap](../product/roadmap.md) · [data-model](data-model.md) · [security-rls](security-rls.md) · [billing-screen](billing-screen.md)
