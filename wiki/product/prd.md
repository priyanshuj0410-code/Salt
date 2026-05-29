---
type: product
updated: 2026-05-29
---

# PRD summary

Synthesis of `salt-prd-v0.3.md` (the raw source — read it for specifics and requirement IDs).

## Vision

A modern, multi-shop, real-time, **offline-resilient** ERP for Indian medical retail, displacing Marg/Tally. The **wedge is multi-counter coordination** (live stock, presence, handoff) — incumbents treat each counter as an isolated file-share install. From there, extend to inventory health, customer-wise pricing, payments, and GST.

## Customer & business

- **Primary persona:** owner-operator of 1–4 shops, 2–4 counters each, ₹50L–₹15cr GMV/shop. Secondary: cashier, pharmacist, accountant, external CA.
- **Bootstrapped**, solo founder + contractors, **₹499/month flat** (first month free), Q1-2027 launch, target **1,000+ shops** in year one, 80%+ migrated from Marg/Tally.

## Goals (v1)

G1 billing ≥Marg-fast for pros and 3× faster for new users · G2 native multi-counter coordination · G3 inventory health by default (near-expiry/low/dead stock) · G4 GST close from days→hours · G5 self-serve <30-min onboarding from Excel/CSV · G6 multi-shop chains with consolidated reporting · G7 full offline business days · G8 allopathy + surgical + ayurveda.

## Functional surfaces

Counter billing (the must-be-superior surface) · Purchase/GRN · Inventory + health dashboards · Customers & **3-scope pricing rules** (product/salt/manufacturer, most-specific wins) · Payments (receivables/payables, cash drawer, bank rec) · Tax/GST (GSTR-1/3B/2A, HSN) · Integrations (GSTN, Razorpay, WhatsApp, Tally export, distributor APIs, Account Aggregator) · Multi-shop & roles (Owner/Manager/Pharmacist/Cashier/Accountant) · ~30 reports · Onboarding/migration · Print (thermal/A4/dot-matrix).

## Notable non-goals (v1)

No `.mbk` Marg-backup parsing (Excel/CSV is enough), no native mobile apps, no hospital-pharmacy mode, no manufacturing, no POS-hardware bundling, no custom report builder, no B2C app, no loyalty, India-only, English+Hindi only, accounting only "enough for a CA to take over".

## Resolved key decisions (PRD §10)

Open-source drug DB (CDSCO/NLEM/AYUSH + crowd-sourced) · ClearTax free-tier GSP first · customer-provided hardware · Razorpay · ₹499 flat (revisit at 100 customers) · **self-host Yjs** for real-time · capped WhatsApp messaging.

## Reality check

Much of the above is **not built yet** — see [roadmap.md](roadmap.md) for what exists vs what's planned, and [../overview.md](../overview.md) for current state.
