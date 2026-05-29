---
type: decision
updated: 2026-05-29
---

# 0001 — Supabase is the backend

**Status:** accepted · **Date:** 2026-05

## Context
A solo founder needs a backend without building/operating one. The PRD recommends NestJS + managed Postgres.

## Decision
Use **Supabase as the entire backend**: Postgres, PostgREST (auto REST API), Auth (GoTrue), Row-Level Security, and Postgres functions/RPCs. The React client talks to it directly via `@supabase/supabase-js`. No separate API server.

## Consequences
- **+** Auth, REST, authorization (RLS), and SQL functions for free; tiny ops surface; fast to build.
- **+** Security lives in the DB (RLS), so it holds even if the client misbehaves → see [0004](0004-strict-rls-isolation.md).
- **−** Business logic that wants a server (complex transactions, integrations, scheduled jobs) must be Postgres RPCs or, later, Supabase Edge Functions.
- **−** Diverges from the PRD's NestJS recommendation → [0002](0002-stack-divergence-from-prd.md).
- Available-but-unused: Edge Functions (Deno), Storage, pg_cron/pg_net.

Correction worth remembering: this is a real backend — don't describe the setup as "no backend".
