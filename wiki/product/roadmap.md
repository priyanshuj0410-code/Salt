---
type: product
updated: 2026-05-29
---

# Roadmap — planned vs as-built

The PRD (§7) sequences four phases over 9–12 months. This page tracks what the repo actually has against that plan. ✅ done · 🟡 partial · ⬜ not started.

## PRD Phase 1 — Foundation (months 1–3)

- ✅ Auth, users, orgs, roles (owner/cashier; PRD wants 5 roles)
- ✅ Customer/party master (via trial-balance import → `ledgers`)
- 🟡 Item master + GRN — `items`/`batches` tables + importers exist; **no GRN screen**, no seeded national drug DB
- 🟡 Basic billing screen — built and keyboard-driven; **does not persist sales** yet (runs off `items`/`batches`)
- ⬜ ElectricSQL sync, shop-local server, Yjs self-host POC — **none started** (the offline/real-time substrate, the PRD's core wedge)
- ⬜ Daily sales report

## PRD Phase 2 — Multi-user & inventory health (4–6)

- ⬜ Real-time sync (presence, live stock, parked bills), multi-counter conflict resolution
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

The **offline-first + real-time multi-counter** substrate — the entire strategic wedge — is not built. The app is currently an online-only Supabase SPA. Sales/GRN/payments/tax are all unbuilt. See [../decisions/0002-stack-divergence-from-prd.md](../decisions/0002-stack-divergence-from-prd.md).
