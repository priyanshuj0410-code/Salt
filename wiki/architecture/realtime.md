---
type: architecture
updated: 2026-06-01
tags: [realtime, multi-counter, activity, supabase]
---

# Real-time / multi-counter substrate

The PRD's strategic wedge (Phase 5) is **offline-first + real-time multi-counter** sync — what no competitor has. The roadmap is honest that none of it was built: the app was an online-only Supabase SPA. This page tracks the substrate as it gets built, ticket by ticket (SALT-100…106, module `realtime`).

## Tech choice: Supabase Realtime (not self-hosted Yjs / ElectricSQL)

> **PRD-vs-as-built divergence (flagged).** The PRD (§7) names **self-hosted Yjs** and **ElectricSQL** for sync. As-built rides **Supabase Realtime** (Postgres Changes + Broadcast + Presence) instead — the same reasoning as ADR [0002](../decisions/0002-stack-divergence-from-prd.md): the backend is already Supabase, so Realtime is zero new infra, RLS-aware, and ships today. Yjs/ElectricSQL remain options for the *offline* CRDT/local-first tickets (SALT-100/101) where Supabase Realtime alone is insufficient; they are not needed for server-authoritative live features (activity, presence, live stock, approvals).

The reusable primitive is a **per-org Postgres-changes channel**: subscribe to `INSERT`s on a table filtered by `org_id`, RLS enforced. One small helper (`lib/activity.ts → subscribeActivity`) that the other live features re-point at their own tables.

## Activity feed — SALT-104 ✅ (first slice)

Shop-wide event log: every sale, payment and GRN, on every counter, live.

**Capture (server-side, decoupled).** Migration `0028_activity_events.sql` adds:
- `activity_events` — append-only log (`kind`, `entity_type/id`, `actor_id/name`, `party_id/name`, `title`, `amount_paise`, `ref`, `meta`), org-scoped, standard `is_member` RLS, indexed `(org_id, created_at desc)`, added to the `supabase_realtime` publication.
- `tg_log_activity()` — one generic `AFTER INSERT` trigger function, parameterized via `TG_ARGV(kind, entity_type)`, attached to `sales_invoices`, `payments`, `purchases`. It reads `to_jsonb(NEW)` and pulls fields with **NULL-safe `->>` over candidate column names**, so the migration can't fail on a column a table happens not to have — the only hard dependency is `id` + `org_id` (guaranteed by the tenancy convention). Actor = `coalesce(created_by, auth.uid())`. Rows are **denormalized** (party/actor names resolved in-trigger) so the realtime payload is self-contained — no client join. Imported/non-posting rows (`posts_effects = false`) are skipped so bulk imports don't flood. Logging is wrapped in `exception when others → return NEW`: it can never break the underlying sale/payment/GRN.

Capturing via triggers — rather than editing billing/payments/GRN code to emit — keeps the cross-cutting feed **decoupled** from those modules (the `realtime` lane owns only its own files).

**Stream + UI.** `lib/activity.ts` (`fetchRecentActivity` + `subscribeActivity`) and `components/activity/ActivityPage.tsx` (`/activity`, nav key `g v`, visible to owner **and** cashier — multi-counter awareness is the point). Initial 200-row fetch + live prepend (de-duped, capped 500); filters by kind (sales/purchases/payments), today-only, and free-text (party/counter/ref); a live/connecting indicator.

## Not yet built (same module)

| Ticket | What | Builds on |
|---|---|---|
| SALT-100 | ElectricSQL offline-first (bill through outages) | local-first; needs CRDT/Electric, beyond Realtime |
| SALT-101 | Self-hosted Yjs presence + live stock <1s LAN + parked-bill sync | Presence + Broadcast channels (Realtime covers most) |
| SALT-102 | Multi-counter conflict resolution (atomic last-unit) | server-authoritative stock decrement (billing RPC) |
| SALT-103 | Shop-local server | infra |
| SALT-105 | Internal messages on bills/customers/items | re-point `subscribeActivity` pattern at a `messages` table |
| SALT-106 | Approve-from-manager-device flow | same channel pattern + an approvals table |

Live stock (SALT-101) and atomic last-unit (SALT-102) land in **billing/inventory** files → filed as tickets for those modules rather than edited here.

## Related
[product/roadmap](../product/roadmap.md) · [decisions/0002](../decisions/0002-stack-divergence-from-prd.md) · [data-model](data-model.md) · [security-rls](security-rls.md) · [billing-screen](billing-screen.md)
