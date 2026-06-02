---
type: index
updated: 2026-06-02
---

# Wiki index

Catalog of every page. Read this first when answering a question, then drill in. Update it on every ingest. The schema and workflows live in [../CLAUDE.md](../CLAUDE.md).

- [overview](overview.md) — what Salt is, current as-built state, and how it diverges from the PRD.
- [log](log.md) — chronological timeline of ingests / builds / decisions.

## Product
- [product/prd](product/prd.md) — vision, customer, goals/non-goals, functional surfaces, pricing (synthesis of `salt-prd-v0.3.md`).
- [product/roadmap](product/roadmap.md) — PRD phases vs as-built (refreshed 2026-06-01: Phases 1–3 largely shipped on the `create_sales_invoice` + 0014–0024 backbone); the remaining gap is offline-first / live-multi-counter; market-informed priority additions.
- [product/market-research](product/market-research.md) — competitor matrix (Marg/GoFrugal/RetailGraph/eVitalRx/Tally), GST pharma rules, Schedule H/H1/X requirements, pain points, modern trends, competitive gaps Salt can fill.
- [product/product-modules](product/product-modules.md) — full platform module map (21 modules across 4 tiers); dependency graph; recommended build sequence.

## Architecture
- [architecture/stack](architecture/stack.md) — monorepo, Vite/React/Tailwind, Supabase backend, deploy/CI, conventions.
- [architecture/core](architecture/core.md) — the authenticated app shell every feature renders inside: session/tenancy context, the route guard, navigation IA, app layout, and the multi-shop working context; owns no business domain.
- [architecture/auth](architecture/auth.md) — anonymous browser → org-scoped session: email/Google/phone-OTP sign-in, onboarding, session lifecycle, MFA, password recovery, and role-based route gating.
- [architecture/data-model](architecture/data-model.md) — tables, migrations 0001–0013, key RPCs, what's not modeled yet.
- [architecture/proposed-data-model](architecture/proposed-data-model.md) — the target model (0014–0024): every nav module on a shared stock + double-entry backbone; multi-shop; **applied & promoted to `supabase/migrations/`** (SALT-140).
- [architecture/schema](architecture/schema.md) — exact table + column definitions (types, nullability, defaults, FKs) for every table.
- [architecture/database](architecture/database.md) — the module that owns `supabase/migrations/`: schema, the security-definer RPCs that are the write path (billing/GST/returns/payments/inventory), and the RLS that enforces tenancy + role — upstream of every other module.
- [architecture/security-rls](architecture/security-rls.md) — Auth, per-org RLS, `is_member`, security-definer RPCs, gaps.
- [architecture/catalogue](architecture/catalogue.md) — the master-data spine: the org-scoped `items` table every module reads, plus the shared global drug reference (`master_items`) and the promote-to-master workflow.
- [architecture/import-pipeline](architecture/import-pipeline.md) — CSV / Go migrator / Smart Importer; trial-balance extraction; merge.
- [architecture/onboarding](architecture/onboarding.md) — signup → first bill: account + GSTIN signup, the first-run setup wizard, the always-visible completeness checklist, and the catalogue/purchase/GL import flows.
- [architecture/marg-import-map](architecture/marg-import-map.md) — everything Marg ERP 9+ can export, mapped to every Salt table; scope for extending Smart Import past today's four files.
- [architecture/smart-import](architecture/smart-import.md) — the as-built Smart Importer overview (file-based Marg/Tally/Saral onboarding); the deep design + phase history is [smart-import-extension](architecture/smart-import-extension.md).
- [architecture/smart-import-extension](architecture/smart-import-extension.md) — engineering design to grow Smart Import to the full Marg dataset (history + compliance): reuse, identity, non-posting load path, net-new schema, phased build.
- [architecture/design-system](architecture/design-system.md) — `design.md` principles + tokens; verified as-built status (tokens, primitives, patterns + density switch built; FormRow pending) + research-backed direction.
- [architecture/accessibility](architecture/accessibility.md) — WCAG 2.1 AA audit (SALT-139): conforming foundations, the global reduced-motion fix, gaps handed off (skip link, muted contrast), and what needs manual browser verification.
- [architecture/interaction-patterns](architecture/interaction-patterns.md) — the keyboard+touch contract: one model/two presentations, the seven laws, per-pattern dual-modality behaviour, the counter as worked example.
- [architecture/screens-routing](architecture/screens-routing.md) — route table, ProtectedRoute guards, role gating, lazy-load rationale; the CI-guarded nav↔route invariant (SALT-142).
- [architecture/billing](architecture/billing.md) — the counter-sale module (`components/billing/`, `store/bill.ts`/`catalog.ts`/`heldBills.ts`, `lib/*`): Salt's core revenue path and the only screen a cashier sees; composes a sale saved via `create_sales_invoice`.
- [architecture/bills](architecture/bills.md) — the post-sale surface (`/bills`): saved-sale history and everything done to an invoice after the counter (view, reprint, returns, share).
- [architecture/print](architecture/print.md) — how a saved sale becomes a physical document: thermal / A4 / dot-matrix invoices + challans (a Drugs & Cosmetics Rules requirement).
- [architecture/billing-screen](architecture/billing-screen.md) — layout, keyboard map, useBill/useCatalog stores, search algorithm, ranked OOS substitutes, FEFO, stock cap, billTotals, line + apportioned bill-level discount, parked/held bills, Schedule H1/X checkout gate, Save & Print + GST split.
- [architecture/gst-returns](architecture/gst-returns.md) — the GST & compliance screens (8): GSTR-1 (+ CDNR/CDNUR credit notes), GSTR-3B (net of returns), live liability, ITC register (+ expired-stock reversal), Tally XML export, a range HSN-summary report, the Schedule H1/X dispensing register (inspector PDF), and invoice-series management, over `sales_invoices`/`sale_lines`/`credit_notes`/`purchases`/`batches`/`h1_register`/`invoice_series`; plus date-effective GST rates (`gst_rate_for`/`gstSchedule.ts`); GSTN JSON + CSV + Tally XML.
- [architecture/grn](architecture/grn.md) — GRN / purchase (inbound): `purchases`/`purchase_lines` + `receive_purchase`, scheme free goods + multi-rate GST + trade discount economics (`lib/grn.ts`), effective cost + ITC, new-item review, the `/purchases` screens.
- [architecture/inventory](architecture/inventory.md) — stock ledger + read views (near-expiry, dead/slow, reorder, out-of-stock, turnover) on `lib/inventory.ts` over `stock_movements`/`batches.qty`; write paths (adjustments, physical count, expiry destruction + ITC reversal) via the `0028` `adjust_stock`/`finalize_physical_count` RPCs.
- [architecture/returns](architecture/returns.md) — partial-return recomputation engine (`lib/returns.ts`, SALT-099): net value / GST / revised ITC on the **effective-cost** basis (taxable ÷ received units, so scheme free-goods + trade discount are honoured), cumulative-rounding so sequential returns leak no paise; one engine for purchase returns (debit note, ITC reversal) and sales returns (credit note, outward-tax reversal).
- [architecture/information-architecture](architecture/information-architecture.md) — full navigation tree, screen inventory, keyboard shortcut system, 7 key user journeys, role-based access, URL structure.
- [architecture/ondc-b2b-pharma](architecture/ondc-b2b-pharma.md) — ONDC/Beckn deep dive for vendor ordering: roles, transaction flow, the OTC-only pharma gate, the two plays (buyer-app procurement vs seller-app retail), onboarding; why it's watch-and-prototype.
- [architecture/payments](architecture/payments.md) — money in/out on the payments ledger: the `record_payment` RPC + tables contract, the as-built `/payments` UI (SALT-003), the allocation/back-dating gaps, and the module roadmap.
- [architecture/parties](architecture/parties.md) — the as-built owner-facing CRM/ledger surface for every counterparty (customers, vendors, control accounts) over `components/parties/**` + `lib/`; complements the domain note [domain/parties](domain/parties.md).
- [architecture/realtime](architecture/realtime.md) — the real-time / multi-counter substrate: Supabase Realtime (vs PRD's Yjs/ElectricSQL), the per-org Postgres-changes primitive, and the shop-wide activity feed (`activity_events` + triggers, `/activity`, SALT-104).
- [architecture/reports](architecture/reports.md) — the Reports module (SALT-073…078): dashboard + sales/purchase/inventory/financial/tax suites over the `v_*` views (0023); the operational-basis filter, `lib/reports.ts` + `fetchAllPaged`, per-suite views, and the org-level financials decision.
- [architecture/operations](architecture/operations.md) — NFR & ops posture (SALT-134/136/137/138): Supabase backup/PITR + restore runbook, at-rest/transit/RLS + no-PII-logs, India residency, audit-trail ownership, and the scale load-test method; with an account-owner action-items table.
- [architecture/infra](architecture/infra.md) — not a feature module (no UI): the root configs + cross-cutting plumbing — CI/CD, build + route code-splitting, migration hygiene, the offline-first read primitive, and ops/NFR posture.
- [architecture/nfr](architecture/nfr.md) — cross-cutting non-functional concerns in the app shell: route-level code-splitting (cold-start), error handling (no white-screens), accessibility, and offline connectivity.
- [architecture/salesman](architecture/salesman.md) — field-salesman management (SALT-128): the `salesmen` master + `commission_pct`/`payments.salesman_id` (0032), commission on net sales, the `/salesmen` master+report and `/salesmen/:id` detail, and order/collection attribution back-fill in `lib/salesmen.ts`.
- [architecture/owner](architecture/owner.md) — the `owner`-role landing dashboard at `/owner`: team management, quick nav, and at-a-glance shop health (`components/owner/`).
- [architecture/settings](architecture/settings.md) — the owner's configuration + administration surface under `/settings/*`: shop identity, team roles, compliance records, data portability, and policy knobs.
- [architecture/offline-first](architecture/offline-first.md) — the offline-first substrate spike + design (SALT-135 / ADR 0017): why a custom IndexedDB read-cache + RPC write-queue (the writes are all RPCs, not rows), the Phase-1 design, and the deferred multi-counter Phase 2.
- [architecture/integrations](architecture/integrations.md) — how Salt talks to outside services: the two shipped (WhatsApp, Razorpay — product-modules §14/§7) over typed seams, the rest gated on credentials/partners; per-integration detail in the two pages below.
- [architecture/integrations-whatsapp](architecture/integrations-whatsapp.md) — WhatsApp send infra (SALT-107): one `sendWhatsApp` seam over two transports (click-to-chat today, opt-in Business/Cloud API via the `whatsapp-send` edge function), a typed template registry for the four Module-14 use cases (reusing the existing `collection`/`billShare` builders), and the `WhatsAppButton` atom.
- [architecture/integrations-razorpay](architecture/integrations-razorpay.md) — Razorpay payment links (SALT-108): server-side link creation via the `razorpay-link` edge function (secret stays server-side; paise = Razorpay's unit), a connection panel + composer that shares the link over the WhatsApp seam, with the webhook→ledger reconciliation (SALT-230) and per-screen wiring (SALT-231) filed as follow-ups.

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
- [0017 — Offline-first substrate: custom local write-queue + read-cache (not a sync engine)](decisions/0017-offline-first-substrate.md)
- [0017 — Offline-first via a local write outbox (not ElectricSQL)](decisions/0017-offline-first-approach.md)
- [0018 — Fractional stock: an integer loose-units component, not a base-unit rewrite](decisions/0018-fractional-stock-loose-units.md)

## Raw sources (immutable, at repo root)
`salt-prd-v0.3.md` · `salt-migrator-prd-v0.1.md` · `design.md` · `salt-design-system.html` · `PRD_Intelligent_Importer.pdf` · the codebase · `Saral/Trial_Balance.xls` (untracked sample).
