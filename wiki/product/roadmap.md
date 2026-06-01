---
type: product
updated: 2026-06-01
---

# Roadmap — planned vs as-built

The PRD (§7) sequences four phases over 9–12 months. This page tracks what the repo actually has against that plan. ✅ done · 🟡 partial · ⬜ not started.

> **As-built reality (2026-06-01).** Most of the PRD's first three phases are built. Sales post through **`create_sales_invoice`** (the old `place_order` is retired), purchases through **`receive_purchase`**, on the **applied 0014–0024 backbone** — multi-shop + signed `stock_movements` + double-entry `ledger_entries`/`chart_accounts` (see [data-model](../architecture/data-model.md); promoted into `supabase/migrations/` by SALT-140). GRN, Inventory, Payments, GST returns, Reports, Print, Catalogue, Onboarding/Smart-Import, and a real-time substrate have all shipped. The remaining frontier is the **offline-first / live-multi-counter** wedge plus a few integrations.

## PRD Phase 1 — Foundation (months 1–3)

- ✅ Auth, users, orgs, roles — owner/cashier + phone/OTP, MFA, password reset, session timeout. ⬜ Full 5-role model + RLS route enforcement (SALT-174/116; SALT-091 blocked).
- ✅ Customer/party master — trial-balance import → `ledgers`, create-party dialog, receivables/payables aging, re-tagging, collection workflow.
- ✅ Item master + **full GRN** — `items`/`batches` + catalogue screens (browse, detail/edit, substitutes, dedup, Ayush flag); GRN with schemes/free-goods + multi-rate GST + trade discount, new-item review, manual + auto PO, PO↔GRN↔invoice match, debit notes. ⬜ A **seeded national drug DB** (SALT-081, blocked).
- ✅ Billing screen — keyboard-driven, customer-bound, persists via **`create_sales_invoice`** with atomic oversell-safe stock decrement, FEFO, line/bill discounts, loose-unit sale, OOS substitutes, parked bills, Schedule H1 hard gate, and **Save & Print** (CGST/SGST/IGST split + HSN). ⬜ Sales return at the counter against the original bill (SALT-015).
- ⬜ ElectricSQL sync, shop-local server, Yjs self-host — **still not started** (the offline substrate; see Phase 2 + the gap note).
- ✅ Daily sales report — owner dashboard (today's sales, cash/credit split, top items) + sales report suite.

## PRD Phase 2 — Multi-user & inventory health (4–6)

- 🟡 Real-time sync — a **Supabase-Realtime substrate** carries the **activity feed** (SALT-104), **internal messages** (SALT-105), and **manager approvals** (SALT-106) live across counters. Still ⬜: **presence**, **live stock on the counter** (SALT-179), **cross-counter parked-bill sync** (SALT-180), **offline-first** (SALT-100/135), and **atomic multi-counter conflict resolution** (SALT-102, blocked). See [../architecture/realtime.md](../architecture/realtime.md).
- ✅ Inventory health dashboards — stock ledger, near-expiry (30/60/90), dead/slow stock, reorder + velocity suggestions, out-of-stock with lost-sales estimate, turnover, physical count + variance, adjustments, expiry destruction (+ ITC reversal). See [../architecture/inventory.md](../architecture/inventory.md).
- ⬜ Customer pricing rules engine (SALT-010/049/050).
- ✅ Schedule H/H1 capture at billing — hard gate + server-side `enforce_h1_gate` + structured Rx params to the RPC. ⬜ Inspector H1/X register screen (SALT-065, blocked).
- 🟡 Payments / credit ledger / receivables-payables — payments UI, make-payment-to-vendor, receipts, bank reconciliation, cash-drawer, post-dated cheques, credit/debit notes, and aging all built. ⬜ **Payment splits in one bill** (SALT-011); credit-limit warning at billing in progress (SALT-004).
- ✅ Print — thermal 58/80mm + A4 + dot-matrix, per-shop templates, bill variants (cash memo / tax invoice / B2B / notes), CGST-Rules-compliant invoice, bilingual.

## PRD Phase 3 — Tax + integrations + scale (7–9)

- ✅ **GST returns** — GSTR-1, GSTR-3B (liability/ITC/reversal/net), ITC register, HSN-wise summary, live current-month liability, Tally XML, and the tax report suite. ⬜ GSTR-2B import for ITC recon (SALT-007); e-invoicing/IRN (SALT-071) and direct GSTN/GSP filing (SALT-072/109) not started. See [../architecture/gst-returns.md](../architecture/gst-returns.md).
- 🟡 WhatsApp / Razorpay — bill + receipt **share** and collection reminders ship today (link/share based); the **WhatsApp Business API** send infra (SALT-107) and **Razorpay** platform integration (SALT-108/169; SALT-062 blocked) are not built.
- ✅ Self-serve onboarding + **Smart Import** — under-2-min signup (GSTIN prefill), setup wizard, completeness checklist, Marg/Tally-shaped templates, dry-run preview + rollback. Smart Import now ingests masters, opening balances, purchase invoices, trial balance, returns, receipts/payments, masters expansion, opening stock, and compliance history. 🟡 Drop-all auto-detect router in progress (SALT-153).

## PRD Phase 4 — Polish & launch (10–12)

- 🟡 Perf — baseline pass shipped (SALT-133); targeted work remains: virtualize the 10k-item list (SALT-154), sub-200ms optimistic counter save (SALT-155).
- 🟡 Accessibility — WCAG AA audit + zoom/screen testing shipped (SALT-139); muted-foreground contrast (SALT-157) + skip-to-content link (SALT-158) remain.
- ⬜ Distributor APIs (SALT-110), mobile dashboard, Hindi UI (bilingual **print** is done), full compliance audit (see Extra work / infra hardening below).

## Extra work not in the PRD phases

- ✅ **Applied 0014–0024 data backbone** — `stock_movements` (signed inventory ledger; `batches.qty` is its cache) + double-entry `ledger_entries`/`chart_accounts`; `place_order`/`orders` retired into `create_sales_invoice` + `receive_purchase`. Promoted into `supabase/migrations/` (SALT-140).
- ✅ **Multi-shop foundation** — `shops` under org, `shop_id` on stock/documents, shop-switcher UI, per-shop config (printer/bank/GSTIN/license).
- ✅ **Ledger financials** — signed opening balances + per-invoice open bills from the trial balance, with column-identity reconciliation.
- ✅ **Party classification + de-duplication** — `classify_parties` + Parties screen + `merge_ledgers`; `merge_items` for the catalogue.
- ✅ **Reports module** — owner dashboard + sales / purchase / inventory / financial / tax report suites over the `v_*` views.
- ✅ CI/CD (GitHub Actions + Vercel), Vercel analytics.
- ✅ This **knowledge wiki**.
- ⬜ **Infra hardening** (open infra lane): reliability/backups/PITR (SALT-134), at-rest encryption + PII-safe logs + GDPR export (SALT-136), data residency + inspector-ready audit trail (SALT-137), load-test to PRD scale (SALT-138).

## Biggest gap to be honest about

The **offline-first** half of the strategic wedge is still unbuilt: the app is online-only. Real-time *multi-counter* has real progress — the cross-counter [activity feed](../architecture/realtime.md), internal messages, and manager approvals run on Supabase Realtime — but **billing through an outage** (SALT-100/135), **live stock** and **parked-bill sync** on the counter (SALT-179/180), **presence**, and **atomic multi-counter conflict resolution** (SALT-102) are still open. The PRD's ElectricSQL + shop-local-server + Yjs design (§6.2) remains a deliberate divergence — see [../decisions/0002-stack-divergence-from-prd.md](../decisions/0002-stack-divergence-from-prd.md).

## Market-informed priority additions

From the [market research](market-research.md). Several have since shipped:

**Shipped:**
- ✅ WhatsApp invoice / receipt sharing (SALT-029/057).
- ✅ Schedule H1 as a hard billing gate (SALT-005) + server-side enforcement (SALT-148).
- ✅ ITC reversal pre-calculation when stock is marked expired (SALT-044/170).
- ✅ Drug-licenses settings screen (SALT-088).

**Still high-value / open:**
- ⬜ Drug-license renewal banner on the owner dashboard (SALT-066).
- ⬜ Inspector-ready H1/X register PDF export (SALT-065, blocked).
- ⬜ GSTR-2B auto-reconciliation against purchase entries (SALT-007).
- ⬜ Purchase-invoice OCR / AI auto-fill from photo or PDF (SALT-027); non-OCR purchase-invoice import already ships (SALT-125).
- ⬜ ABHA / ABDM (SALT-131) and ONDC (SALT-130/132) — future tier.
- ⬜ **Drug master database** — still none (SALT-081, blocked). The crowd-sourced MRP/PTR-from-GRN refinement (SALT-082) is built and is the more defensible long-term moat, but a ~50k seed (CDSCO/NLEM/open sources) is needed first.
