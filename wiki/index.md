---
type: index
updated: 2026-05-31
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
- [architecture/marg-import-map](architecture/marg-import-map.md) — everything Marg ERP 9+ can export, mapped to every Salt table; scope for extending Smart Import past today's four files.
- [architecture/smart-import-extension](architecture/smart-import-extension.md) — engineering design to grow Smart Import to the full Marg dataset (history + compliance): reuse, identity, non-posting load path, net-new schema, phased build.
- [architecture/design-system](architecture/design-system.md) — `design.md` principles + tokens; verified as-built status (tokens, primitives, patterns + density switch built; FormRow pending) + research-backed direction.
- [architecture/interaction-patterns](architecture/interaction-patterns.md) — the keyboard+touch contract: one model/two presentations, the seven laws, per-pattern dual-modality behaviour, the counter as worked example.
- [architecture/screens-routing](architecture/screens-routing.md) — route table, ProtectedRoute guards, role gating, lazy-load rationale.
- [architecture/billing-screen](architecture/billing-screen.md) — layout, keyboard map, useBill/useCatalog stores, search algorithm, FEFO, stock cap, billTotals, Schedule H1/X checkout gate, Save & Print + GST split.
- [architecture/gst-returns](architecture/gst-returns.md) — GST returns: GSTR-1 (B2B/B2CL/B2CS/HSN) and GSTR-3B (output − ITC = net payable), read from `sales_invoices`/`sale_lines`/`purchases`; GSTN JSON + CSV export.
- [architecture/information-architecture](architecture/information-architecture.md) — full navigation tree, screen inventory, keyboard shortcut system, 7 key user journeys, role-based access, URL structure.
- [architecture/ondc-b2b-pharma](architecture/ondc-b2b-pharma.md) — ONDC/Beckn deep dive for vendor ordering: roles, transaction flow, the OTC-only pharma gate, the two plays (buyer-app procurement vs seller-app retail), onboarding; why it's watch-and-prototype.
- [architecture/payments](architecture/payments.md) — money in/out on the payments ledger: the `record_payment` RPC + tables contract, the as-built `/payments` UI (SALT-003), the allocation/back-dating gaps, and the module roadmap.

## Domain
- [domain/medical-retail](domain/medical-retail.md) — glossary: salt, schedules, batches/FEFO, MRP/PTR, GST/HSN, drug DB plan.
- [domain/trial-balance](domain/trial-balance.md) — Saral/Marg/Tally export format, Dr/Cr, the reconciliation identity, bill lines.
- [domain/marg-export-guide](domain/marg-export-guide.md) — operator playbook: how to export each file from Marg (menu paths, columns, join keys, gotchas, export-order checklist).
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
- [0010 — GSTIN as canonical party identity](decisions/0010-gstin-canonical-party-identity.md)
- [0011 — Document import idempotency key](decisions/0011-document-import-idempotency-key.md)
- [0012 — Stock cutover: snapshot, not replay](decisions/0012-stock-cutover-snapshot-vs-replay.md)
- [0013 — GL history depth: opening balances only](decisions/0013-gl-history-depth.md)
- [0014 — Doctors master table](decisions/0014-doctors-master.md)
- [0015 — Dual-modality interaction: one system for keyboard and touch](decisions/0015-dual-modality-interaction.md)
- [0016 — Vendor ordering is distributor-mediated (aggregator BD or ONDC, not manufacturer APIs)](decisions/0016-vendor-ordering-channel.md)

## Raw sources (immutable, at repo root)
`salt-prd-v0.3.md` · `salt-migrator-prd-v0.1.md` · `design.md` · `salt-design-system.html` · `PRD_Intelligent_Importer.pdf` · the codebase · `Saral/Trial_Balance.xls` (untracked sample).
