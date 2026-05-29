---
type: index
updated: 2026-05-29
---

# Wiki index

Catalog of every page. Read this first when answering a question, then drill in. Update it on every ingest. The schema and workflows live in [../CLAUDE.md](../CLAUDE.md).

- [overview](overview.md) — what Salt is, current as-built state, and how it diverges from the PRD.
- [log](log.md) — chronological timeline of ingests / builds / decisions.

## Product
- [product/prd](product/prd.md) — vision, customer, goals/non-goals, functional surfaces, pricing (synthesis of `salt-prd-v0.3.md`).
- [product/roadmap](product/roadmap.md) — PRD phases vs as-built; the big gaps (offline/real-time, sales/GRN/tax).

## Architecture
- [architecture/stack](architecture/stack.md) — monorepo, Vite/React/Tailwind, Supabase backend, deploy/CI, conventions.
- [architecture/data-model](architecture/data-model.md) — tables, migrations 0001–0009, key RPCs, what's not modeled yet.
- [architecture/security-rls](architecture/security-rls.md) — Auth, per-org RLS, `is_member`, security-definer RPCs, gaps.
- [architecture/import-pipeline](architecture/import-pipeline.md) — CSV / Go migrator / Smart Importer; trial-balance extraction; merge.
- [architecture/design-system](architecture/design-system.md) — `design.md` principles + tokens; the as-built-vs-spec gap.

## Domain
- [domain/medical-retail](domain/medical-retail.md) — glossary: salt, schedules, batches/FEFO, MRP/PTR, GST/HSN, drug DB plan.
- [domain/trial-balance](domain/trial-balance.md) — Saral/Marg/Tally export format, Dr/Cr, the reconciliation identity, bill lines.
- [domain/parties](domain/parties.md) — customer/vendor/other classification, balances/bills, merge flow.

## Decisions
- [0001 — Supabase as backend](decisions/0001-supabase-as-backend.md)
- [0002 — Stack divergence from the PRD](decisions/0002-stack-divergence-from-prd.md)
- [0003 — Money as integer paise](decisions/0003-money-as-paise.md)
- [0004 — Strict per-org RLS isolation](decisions/0004-strict-rls-isolation.md)
- [0005 — Faithful import + user-driven merge](decisions/0005-faithful-import-and-merge.md)
- [0006 — Trial-balance column identity + positional parse](decisions/0006-trial-balance-column-identity.md)

## Raw sources (immutable, at repo root)
`salt-prd-v0.3.md` · `salt-migrator-prd-v0.1.md` · `design.md` · `salt-design-system.html` · `PRD_Intelligent_Importer.pdf` · the codebase · `Saral/Trial_Balance.xls` (untracked sample).
