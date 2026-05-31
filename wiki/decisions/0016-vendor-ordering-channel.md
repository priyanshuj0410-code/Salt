---
type: decision
updated: 2026-05-31
---

# 0016 — Vendor ordering is distributor-mediated (aggregator BD or ONDC, not manufacturer APIs)

**Status:** accepted (research; pre-implementation) · **Date:** 2026-05-31

## Context

Salt tags a ledger as a vendor using the `known_vendors` seed in `supabase/migrations/0008_ledger_financials.sql` — ~60 major pharma **manufacturer** brand names (Abbott, Cipla, Sun Pharma, Mankind, Lupin, Torrent, …). A natural feature request is "integrate vendors' ordering APIs so a chemist can reorder stock from inside Salt." Research into whether those vendors expose order-placing APIs produced a clear, channel-level answer.

India's drug channel is **Manufacturer → C&F agent → Distributor/Stockist → Retailer.** A chemist never buys from a manufacturer; they buy from a local distributor who stocks many manufacturers. Our own data confirms it: the real payables in `Saral/Trial_Balance.xls` are to distribution entities ("SUN PHARMA **DISTRIBUTORS** LTD", "Vishwanath Pharmaceuticals", "Shree Batuk Pharma"), not manufacturing HQs. So **`known_vendors` is a classification list, not a set of order-able counterparties** — and manufacturers neither sell to retailers directly nor publish retailer ordering APIs.

The only electronic-ordering rails are a handful of B2B aggregators and the open ONDC network. None offers a public, self-serve developer API a third-party retail ERP can simply onboard to:

| Surface | Order-placing API for an ERP like Salt? |
|---|---|
| **Manufacturers** (the `known_vendors`) | **No** — wrong channel layer; they sell via distributors |
| **Pharmarack** (largest B2B network; how Marg ships this) | Partnership/BD only — no public API found; integrates on the *distributor's* billing software |
| **Retailio** (PharmEasy/Ascent group) | Plugs into the *distributor's* ERP/POS; retailer side is their own app — no open ERP API |
| **Saveo** | *Consumes* supplier APIs for its own engine; not an API provider to ERPs |
| **eVitalRx** | Has an API product, but it's EMR↔pharmacy (prescriptions), **not** procurement |
| **ONDC** | The only **open, documented protocol** (Beckn) — but pharma B2B is nascent (OTC/B2C only, no Rx); see [architecture/ondc-b2b-pharma](../architecture/ondc-b2b-pharma.md) |

Live stock/price/scheme data lives inside the **distributor's** billing software (C-Square PharmAssist, Marg). Integrating thousands of those directly is impractical — that integration moat *is* the aggregators' product.

## Decision

Treat vendor ordering as **distributor-mediated**, and model/integrate accordingly:

- **Do not** model ordering against `known_vendors` (manufacturers). Any ordering feature targets **distributor** ledgers (`ledgers.type = 'vendor'`), keyed by GSTIN per [0010](0010-gstin-canonical-party-identity.md).
- **Integration path is one of two**, never a manufacturer API:
  - **(a) Aggregator BD partnership** (Pharmarack and/or Retailio) — closed and partnership-gated, but live today and the broadest distributor coverage. Matches the competitor benchmark (Marg's eBusiness/Pharmarack).
  - **(b) ONDC buyer app** — open and standardised, but **gated by seller liquidity + the Rx restriction**; a watch-and-prototype bet, not near-term. Detail in [architecture/ondc-b2b-pharma](../architecture/ondc-b2b-pharma.md).
- **Near-term stopgap (no integration dependency):** a **structured PO → WhatsApp/PDF export** — generate an order from low-stock items and share it to the distributor. Delivers ~80% of the value and seeds the `purchase_orders` table already drafted in [proposed-data-model](../architecture/proposed-data-model.md); this is exactly what Module 18 ("eliminate the WhatsApp order cycle") anticipates.

## Consequences

- **(+)** Stops a dead-end (chasing manufacturer APIs that don't exist) before any code is written.
- **(+)** Correctly points an eventual feature at distributors and at `purchase_orders`/`po_lines`, which already exist as hooks.
- **(+)** Gives a shippable near-term path (PO export) decoupled from any partner or network.
- **(−)** Real electronic ordering requires either a commercial BD deal (loss of control, revenue share, partner roadmap dependency) or waiting on ONDC's pharma readiness — neither is self-serve.
- **(−)** ONDC's two plays cut in opposite directions (buyer-app *procurement* = Module 18; seller-app *retail* = Module 21) and must not be conflated when scoped.
- **Not on the v1 critical path** — Phase 1–3 (billing/GRN/payments/GST) come first; this is Tier-4 (Phase 6) surface.

See [architecture/ondc-b2b-pharma](../architecture/ondc-b2b-pharma.md) · [product/product-modules](../product/product-modules.md) (Modules 18, 21) · [0010](0010-gstin-canonical-party-identity.md) · [domain/parties](../domain/parties.md)
