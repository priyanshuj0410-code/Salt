---
type: decision
updated: 2026-05-29
---

# 0004 — Strict per-org RLS isolation

**Status:** accepted · **Date:** 2026-05

## Context
Multi-tenant SaaS where the client talks to Postgres directly via PostgREST. The user wanted tenants "physically separated, not just logically." True physical separation (DB-per-tenant) is heavy ops for a solo founder.

## Decision
**Logical isolation enforced by deny-by-default Row-Level Security.** Every business table has `org_id` and four RLS policies (select/insert/update/delete) each gated on `is_member(org_id)`. The anon/publishable key is all the client gets; RLS decides what it can touch. Cross-org access is impossible through the API regardless of client bugs.

## Consequences
- **+** One database, simple ops, yet a hard per-org boundary at the data layer (not just the UI).
- **+** Security-definer RPCs (`create_org`, `redeem_invite`, `redeem_migration_token`, `classify_parties`, `merge_ledgers`) re-check membership internally.
- **−** Not physical isolation — a Postgres/RLS misconfiguration could cross tenants; mitigated by deny-by-default and testing isolation.
- **−** Per-role *row* permissions (PRD FR-U-012) aren't enforced in the DB yet; role-gating is currently UI-level on routes. See [../architecture/security-rls.md](../architecture/security-rls.md).
