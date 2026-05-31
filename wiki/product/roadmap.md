---
type: product
updated: 2026-06-01
---

# Roadmap — planned vs as-built

The PRD (§7) sequences four phases over 9–12 months. This page tracks what the repo actually has against that plan. ✅ done · 🟡 partial · ⬜ not started.

## PRD Phase 1 — Foundation (months 1–3)

- ✅ Auth, users, orgs, roles (owner/cashier; PRD wants 5 roles)
- ✅ Customer/party master (via trial-balance import → `ledgers`)
- 🟡 Item master + GRN — `items`/`batches` + importers exist; a **GRN-lite purchase entry** (vendor profile → adds stock via `place_order`) now exists; still no full GRN (schemes, new-item creation, PO match) or seeded national drug DB
- 🟡 Billing screen — built, keyboard-driven, customer-bound (picker, default Walk-in), and **now persists sales** via `place_order` (0010) with stock decrement + a `/bills` history. Still missing: real print, returns, per-org invoice series.
- ⬜ ElectricSQL sync, shop-local server, Yjs self-host POC — **none started** (the offline/real-time substrate, the PRD's core wedge)
- ⬜ Daily sales report

## PRD Phase 2 — Multi-user & inventory health (4–6)

- 🟡 Real-time sync (presence, live stock, parked bills), multi-counter conflict resolution — a **shop-wide activity feed** (`/activity`) now streams every sale/payment/GRN live across counters on **Supabase Realtime** (SALT-104), the first slice of the substrate; presence, live stock, parked bills, conflict resolution still ⬜. See [../architecture/realtime.md](../architecture/realtime.md)
- ⬜ Inventory health dashboards (near-expiry / low / dead stock)
- ⬜ Customer pricing rules engine
- ⬜ Schedule H/H1 capture at billing
- ⬜ Payment splits, credit ledger, receivables/payables
- ⬜ Print (thermal/A4)

## PRD Phase 3 — Tax + integrations + scale (7–9)

- ⬜ GSTR-1/3B/2A, Tally export, WhatsApp, Razorpay
- 🟡 Self-serve onboarding — **Smart Importer** (ledgers/items/batches, auto-map, quarantine) + CSV importer + Go migrator are built; setup wizard and Marg/Tally-shaped templates are not

## PRD Phase 4 — Polish & launch (10–12)

- ⬜ Perf, distributor APIs, mobile dashboard, Hindi, a11y/compliance audits

## Extra work not in the PRD phases

- ✅ **Ledger financials** — signed opening balances + per-invoice open bills from the trial balance, with column-identity reconciliation
- ✅ **Party classification + de-duplication** — `classify_parties` + the Parties screen + `merge_ledgers`
- ✅ CI/CD (GitHub Actions + Vercel), Vercel analytics
- ✅ This **knowledge wiki**

## Biggest gaps to be honest about

The **offline-first + real-time multi-counter** substrate — the entire strategic wedge — is barely started. The app is online-only; the first live slice landed (the cross-counter [activity feed](../architecture/realtime.md), SALT-104, on Supabase Realtime), but **offline-first** (bill through outages), **live stock**, **presence**, and **multi-counter conflict resolution** are still unbuilt. See [../decisions/0002-stack-divergence-from-prd.md](../decisions/0002-stack-divergence-from-prd.md).

## Market-informed priority additions

From the [market research](market-research.md), several high-value items are missing from the PRD phases and should be incorporated:

**Low effort / high signal (build soon):**
- Drug license renewal alerts (missing from every competitor; strong demo moment)
- WhatsApp invoice sharing (table stakes in India; eVitalRx/Marg/GoFrugal all have it)
- Inspector-ready Schedule H1 register PDF export (once H1 gate is built — Law 17(5)(h))
- ITC reversal pre-calculation when stock is marked expired (statutory; gap everywhere)

**Medium effort / strong differentiator:**
- Schedule H1 as a hard billing gate (block sale until all register fields filled; GoFrugal does this; others don't enforce it — a real compliance differentiator)
- GSTR-2B auto-reconciliation against purchase entries (gap across every competitor; monthly compliance pain for every pharmacy)
- ABHA / ABDM integration (74 Cr+ ABHA IDs issued; referral traffic from hospitals/clinics)

**High effort / strategic:**
- Purchase invoice OCR / AI auto-fill from photo or WhatsApp-forwarded PDF (Marg does this; single highest-value AI feature for daily workflow)
- ONDC integration (eVitalRx is first; lets a standalone pharmacy list on ONDC without building an app)
- Flat-rate multi-store pricing (GoFrugal charges per-store; a flat-rate model is a wedge into chains)

**Data moat:**
- Drug master database — eVitalRx has 4 lakh+ entries; Salt has none yet. The PRD's crowdsourced GRN approach (crowd-source MRP/PTR from actual GRN entries) is more defensible long-term than a one-time static import, but a seed of ~50k drugs (from CDSCO/NLEM/open sources) is needed first.
