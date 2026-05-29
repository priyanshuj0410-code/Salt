---
type: overview
updated: 2026-05-29
---

# Salt — Overview

**Salt is a cloud-first ERP for Indian medical retail** — chemists, surgical suppliers, and ayurveda outlets. It aims to displace Marg/Tally with a modern, multi-shop, real-time, offline-resilient product. The name comes from how the trade talks: *"iska salt kya hai?"* — what's the active molecule. Salt-based search and substitutes are the unifying primitive.

- **Strategic wedge:** real multi-counter coordination (live stock, presence, handoff), where incumbents only bolt file-share onto single-user installs.
- **Customer:** owner-operator of 1–4 shops, 2–4 counters each; cashiers, pharmacists, an accountant.
- **Business shape:** bootstrapped, solo founder + contractors, ₹499/month flat, target 1,000+ paying shops within a year of a Q1-2027 launch.

See [product/prd.md](product/prd.md) for the full vision, goals/non-goals, and functional surfaces.

## Current state (as-built)

What actually exists in the repo today — a meaningful slice of the billing + onboarding surfaces, on a deliberately leaner stack than the PRD's recommendation:

- **Counter billing screen** — salt/name search, keyboard-driven, batch picker (FEFO), per-line qty/discount, earnings/loss display, cash-vs-credit payment. (`apps/web/src/components/billing`)
- **Auth & multi-tenancy** — Supabase Auth (email/password + Google), `orgs` + `memberships`, owner/cashier roles, onboarding (create org / join by invite code), strict per-org RLS.
- **Data import** — three paths: a CSV catalogue importer, the Go **migrator** (Marg DBF → upload via token RPC), and the **Smart Importer** (cascade stepper: ledgers → items → batches, with auto-map, report-aware extraction, and quarantine).
- **Ledger financials** — the Smart Importer's Ledgers step parses a Saral/Marg/Tally **trial balance** into parties with signed opening balances and per-invoice open bills, classifies them customer/vendor/other, and runs quality checks. See [architecture/import-pipeline.md](architecture/import-pipeline.md).
- **Parties screen + merge** — owner view to edit party type/GSTIN/phone and merge duplicates (suggest-and-confirm). See [domain/parties.md](domain/parties.md).

Migrations `0001`–`0009` define the schema → [architecture/data-model.md](architecture/data-model.md).

## How as-built differs from the PRD

The PRD §6 recommends NestJS + ElectricSQL (offline-first) + self-hosted Yjs (real-time) + shop-local servers + a zinc design-token system. The build so far is a **Vite SPA talking directly to Supabase** — no NestJS, no ElectricSQL, no Yjs, no local server, no offline yet. This is a reasonable bootstrapping choice (ship the UX + data model first; add the sync substrate later), but the offline/real-time wedge from the PRD is **not yet built**. Tracked in [decisions/0002-stack-divergence-from-prd.md](decisions/0002-stack-divergence-from-prd.md).

## Map of the wiki

- **Product:** [prd.md](product/prd.md) · [roadmap.md](product/roadmap.md)
- **Architecture:** [stack](architecture/stack.md) · [data-model](architecture/data-model.md) · [security-rls](architecture/security-rls.md) · [import-pipeline](architecture/import-pipeline.md) · [design-system](architecture/design-system.md)
- **Domain:** [medical-retail](domain/medical-retail.md) · [trial-balance](domain/trial-balance.md) · [parties](domain/parties.md)
- **Decisions:** [index.md](index.md#decisions)
