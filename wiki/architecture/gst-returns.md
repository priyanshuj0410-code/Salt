---
type: architecture
updated: 2026-06-01
tags: [gst, compliance, sales]
---

# GSTR-1 export (outward supplies)

First slice of the **GST & compliance** module (SALT-002, product-modules §9). A
read-only return: aggregates one shop's month of outward sales into the GSTN sections and
exports portal-ready JSON + CSV. Screen at `/gst` (`components/gst/Gstr1Page.tsx`); all
aggregation in `lib/gst.ts`, which is **pure** (no Supabase) and unit-smoke-tested.

## Read contract (as-built)

> ⚠️ **Stale-wiki flag.** The live sales tables are **`sales_invoices` / `sale_lines`**,
> written by the `create_sales_invoice` RPC — the [proposed model](proposed-data-model.md)
> (`supabase/proposed/0018_sales.sql`) was adopted. [data-model.md](data-model.md) still
> describes `orders`/`order_lines` + `place_order`; that section is **out of date**. Queued
> for a wiki-lint reconcile.

GSTR-1 needs **no new schema** — the CGST/SGST/IGST split is computed and stored at
**write time** (intra-state ⇒ CGST+SGST, inter-state ⇒ IGST, decided by shop vs party
state):

- `sales_invoices`: `invoice_date, is_interstate, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, status, posts_effects, party_id, shop_id`.
- `sale_lines`: `gst_rate, qty, taxable_paise, cgst/sgst/igst_paise`, `item_id → items.hsn`.
- Filer identity = `shops.gstin` / `shops.state_code` (**a shop files under its own GSTIN**).

Scope filter: one `shop_id`, `status = 'placed'`, `posts_effects = true` (imported
pre-cutover history is excluded — already filed elsewhere), `invoice_date` within the month.

## Sections (`buildGstr1`)

- **B2B** — recipient has a GSTIN; grouped recipient GSTIN → invoice → rate.
- **B2CL** — B2C, inter-state, invoice ≥ ₹2.5L (`B2CL_THRESHOLD_PAISE`); itemised by rate.
- **B2CS** — remaining B2C; aggregated by place-of-supply + supply type + rate.
- **HSN** — every line by `hsn × rate` (qty + taxable + taxes); spans B2B and B2C.
- Place of supply = recipient `state_code`, falling back to the shop's state for walk-ins.

Section breakdowns and the headline totals both derive from the **lines**, so they reconcile.

## Export

- `buildGstr1Json` → GSTN-shaped `{ gstin, fp, b2b, b2cl, b2cs, hsn }` (amounts in rupees,
  dates `DD-MM-YYYY`, `fp = MMYYYY`).
- `gstr1ToCsv` → one flat CSV across all sections (spreadsheet fallback).

## Deferred

Credit notes (CDNR — Returns module unbuilt) · server-side `v_gstr1_*` views (proposed
`0022_gst_compliance.sql` matches the live schema and can be promoted by the database
chat) · GSTR-3B, GSTR-2B recon (SALT-007, smart-import), ITC register, H1/X register,
drug-license alerts (other GST slices).

Links: [product/product-modules](../product/product-modules.md) §9 ·
[domain/orders](../domain/orders.md) ·
[decisions/0010](../decisions/0010-gstin-canonical-party-identity.md)
