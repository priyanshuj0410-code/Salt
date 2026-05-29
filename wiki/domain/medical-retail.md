---
type: domain
updated: 2026-05-29
---

# Indian medical retail — domain glossary

Context that the product is built around. Sourced from `salt-prd-v0.3.md` and the trial-balance work.

## Market

~850,000 chemist shops, ~₹2.5 lakh crore/year. Software is dominated by **Marg ERP** (20–25%), then Tally, Vyapar, RetailGraph — keyboard-only, DOS-era, single-user-first. Scope for Salt: **allopathic pharma + surgical disposables + ayurveda** (not pharma-only).

## Core concepts

- **Salt / molecule** — the active pharmaceutical ingredient (e.g. "paracetamol"). The trade asks *"iska salt kya hai?"*. Search and substitution pivot on salt; a **substitute** is a same-salt, in-stock alternative.
- **Schedule (H / H1 / X)** — regulatory classes under the Drugs & Cosmetics Act for prescription-controlled drugs. Selling them requires capturing prescriber/patient details; **H1** sales go in a separate register for drug-inspector audits. **OTC** = unscheduled. (As-built: `items.schedule` exists; the billing-time prescription capture is not built yet.)
- **Batch / expiry / FEFO** — stock is tracked per batch (batch no, expiry, MRP-at-receipt, PTR-at-receipt). Sales decrement **First-Expiry-First-Out**.
- **MRP vs PTR vs PTS** — MRP = printed retail price (GST-inclusive). **PTR** = price-to-retailer (what the shop pays the distributor). PTS = price-to-stockist. Margin lives between PTR and MRP. (As-built: `batches.mrp_paise`, `batches.ptr_paise`.)
- **Scheme** — distributor free-goods deal (e.g. "10+1") that lowers effective cost; line-level, affects costing. (Not built yet.)
- **GRN** — Goods Receipt Note; receiving stock against a purchase. (Not built yet.)

## GST & tax (India)

- Pharma pricing is **MRP-inclusive of GST** — the cashier never types GST; it's extracted from MRP.
- **CGST + SGST** for intra-state sales, **IGST** for inter-state. Tracked HSN-wise (pharma = HSN chapter 30, surgicals = chapter 90).
- Filing surfaces (PRD): GSTR-1 (outward), GSTR-3B (summary), GSTR-2A reconciliation. E-invoicing threshold (₹5 cr aggregate turnover) — most target shops are below it. (None built yet.)

## Drug master DB (planned)

PRD plan: seed ~20–25k SKUs from **open sources** (CDSCO approvals, NLEM, AYUSH formularies, GSTN HSN) with identity fields populated but pricing empty; refine MRP/PTR via **crowd-sourced** GRN data (a network-effects moat). Do **not** scrape commercial catalogs (1mg/PharmEasy) — legal risk. (Not built yet.)

## Related
[trial-balance](trial-balance.md) · [parties](parties.md) · [product/prd](../product/prd.md)
