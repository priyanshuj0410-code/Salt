---
type: decision
updated: 2026-05-29
---

# 0002 — Stack divergence from the PRD

**Status:** accepted (revisit before building the sync/offline wedge) · **Date:** 2026-05

## Context
PRD §6 recommends NestJS + ElectricSQL (offline-first) + self-hosted Yjs (real-time) + BullMQ/Redis + a shop-local server mirroring Postgres→SQLite. That's the substrate for the product's core wedge: offline-resilient, real-time multi-counter coordination.

## Decision
Build first as a **Vite SPA talking directly to Supabase** — no NestJS, no ElectricSQL, no Yjs, no local server, no offline. Ship the UX, data model, auth, and onboarding/import on the leanest stack that works; defer the sync substrate.

## Consequences
- **+** Dramatically faster to a usable product (billing UI, auth, multi-tenant data, import) for a solo founder.
- **+** The data model and screens are reusable when the sync layer is added later.
- **−** The **strategic wedge is not built**: the app is online-only and single-session; live cross-counter stock, presence, parked-bill handoff, and offline business days don't exist yet.
- **−** Adding ElectricSQL/Yjs later is a real project (the PRD budgets a week-1 POC + 3–4 weeks for Yjs). Retrofitting offline onto screens not designed for it has risk.

## Revisit when
Starting multi-counter / offline work. Do the PRD's week-1 sync POC (ElectricSQL vs PowerSync; Yjs self-host vs Liveblocks) before committing screens to a sync model. Track current gaps in [../product/roadmap.md](../product/roadmap.md).
