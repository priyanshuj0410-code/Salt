---
type: index
updated: 2026-05-30
---

# Wiki index

Catalog of every page. Read this first when answering a question, then drill in. Update it on every ingest. The schema and workflows live in [../CLAUDE.md](../CLAUDE.md).

- [overview](overview.md) — what Salt is, current as-built state, and how it diverges from the PRD.
- [log](log.md) — chronological timeline of ingests / builds / decisions.

## Product
- [product/prd](product/prd.md) — vision, customer, goals/non-goals, functional surfaces, pricing (synthesis of `salt-prd-v0.3.md`).
- [product/roadmap](product/roadmap.md) — PRD phases vs as-built; the big gaps (offline/real-time, sales/GRN/tax); market-informed priority additions.
- [product/market-research](product/market-research.md) — competitor matrix (Marg/GoFrugal/RetailGraph/eVitalRx/Tally), GST pharma rules, Schedule H/H1/X requirements, pain points, modern trends, competitive gaps Salt can fill.
- [product/product-modules](product/product-modules.md) — full platform module map (21 modules across 4 tiers); dependency graph; recommended build sequence.

## Architecture
- [architecture/stack](architecture/stack.md) — monorepo, Vite/React/Tailwind, Supabase backend, deploy/CI, conventions.
- [architecture/data-model](architecture/data-model.md) — tables, migrations 0001–0013, key RPCs, what's not modeled yet.
- [architecture/proposed-data-model](architecture/proposed-data-model.md) — draft SQL (0014–0024) giving every nav module a clean model on a shared stock + double-entry backbone; multi-shop; unrun.
- [architecture/schema](architecture/schema.md) — exact table + column definitions (types, nullability, defaults, FKs) for every table.
- [architecture/security-rls](architecture/security-rls.md) — Auth, per-org RLS, `is_member`, security-definer RPCs, gaps.
- [architecture/import-pipeline](architecture/import-pipeline.md) — CSV / Go migrator / Smart Importer; trial-balance extraction; merge.
- [architecture/design-system](architecture/design-system.md) — `design.md` principles + tokens; the as-built-vs-spec gap.
- [architecture/screens-routing](architecture/screens-routing.md) — route table, ProtectedRoute guards, role gating, lazy-load rationale.
- [architecture/billing-screen](architecture/billing-screen.md) — layout, keyboard map, useBill/useCatalog stores, search algorithm, FEFO, stock cap, billTotals.
- [architecture/information-architecture](architecture/information-architecture.md) — full navigation tree, screen inventory, keyboard shortcut system, 7 key user journeys, role-based access, URL structure.

## Domain
- [domain/medical-retail](domain/medical-retail.md) — glossary: salt, schedules, batches/FEFO, MRP/PTR, GST/HSN, drug DB plan.
- [domain/trial-balance](domain/trial-balance.md) — Saral/Marg/Tally export format, Dr/Cr, the reconciliation identity, bill lines.
- [domain/parties](domain/parties.md) — customer/vendor/other classification, balances/bills, merge flow.
- [domain/orders](domain/orders.md) — orders/bills model, walk-in, payment/settlement, the amount-due formula.
- [domain/persona-wholesale-owner](domain/persona-wholesale-owner.md) — deep persona: multi-counter wholesale dealer in tier 2/3 India; keyboard-first, unreliable internet, Marg power user, credit-driven business.

## Decisions
- [0001 — Supabase as backend](decisions/0001-supabase-as-backend.md)
- [0002 — Stack divergence from the PRD](decisions/0002-stack-divergence-from-prd.md)
- [0003 — Money as integer paise](decisions/0003-money-as-paise.md)
- [0004 — Strict per-org RLS isolation](decisions/0004-strict-rls-isolation.md)
- [0005 — Faithful import + user-driven merge](decisions/0005-faithful-import-and-merge.md)
- [0006 — Trial-balance column identity + positional parse](decisions/0006-trial-balance-column-identity.md)
- [0007 — Client-side UUID generation for ledger linkage](decisions/0007-client-side-uuid-generation.md)
- [0008 — Import join keys: name for parties, code for products](decisions/0008-import-join-keys.md)
- [0009 — Target data model: full IA on a shared backbone](decisions/0009-target-data-model.md)

## Raw sources (immutable, at repo root)
`salt-prd-v0.3.md` · `salt-migrator-prd-v0.1.md` · `design.md` · `salt-design-system.html` · `PRD_Intelligent_Importer.pdf` · the codebase · `Saral/Trial_Balance.xls` (untracked sample).
