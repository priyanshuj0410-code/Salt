---
type: architecture
updated: 2026-06-01
tags: [gst, compliance, sales]
---

# GST & compliance — returns, liability, ITC, exports

The **GST & compliance** module's six screens (SALT-002/063/064/068/069/070/170; product-modules §9):
read-only views that aggregate one shop's documents into the GSTN sections, a live tax position,
the ITC ledger, and accountant exports — all with portal-ready JSON / CSV / Tally XML. Screens
under `/gst` (`Gstr1Page`, `Gstr3bPage`, `GstLiabilityPage`, `ItcRegisterPage`, `TallyExportPage`,
`HsnReportPage` in `components/gst/`); all aggregation in `lib/gst.ts`, which is **pure** (no
Supabase) and unit-smoke-tested.

## Read contract (as-built)

> ⚠️ **Stale-wiki flag.** The live sales tables are **`sales_invoices` / `sale_lines`**,
> written by the `create_sales_invoice` RPC — the [proposed model](proposed-data-model.md)
> (`supabase/migrations/0018_sales.sql`) was adopted. [data-model.md](data-model.md) still
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

## GSTR-3B (summary return)

`buildGstr3b(period, sales, purchases, reversalPaise)` (screen `/gst/gstr3b`) nets the month's tax:

- **Output tax** — summed per head (CGST/SGST/IGST) from the period's `sales_invoices`
  (same scope as GSTR-1: shop, `status='placed'`, `posts_effects=true`).
- **Gross ITC** — summed per head from `purchases` (`status='received'`,
  `posts_effects=true`, `received_date` in month); `receive_purchase` stores the split the
  same way `create_sales_invoice` does.
- **Net payable** = `max(0, output − net ITC)` after full credit set-off (the cash figure),
  where net ITC = gross ITC − the Table-4B reversal below; per-head `balance` is shown for
  detail; surplus ITC is reported as credit carried forward.
- `buildGstr3bJson` → GSTN-style `{ gstin, ret_period, sup_details, itc_elg, net_payable }`;
  `gstr3bToCsv` for spreadsheets.
- **ITC reversal (Table 4B)** is wired from **expiry write-offs** (`stock_movements`,
  `reason='writeoff'`, period-scoped): `buildWriteoffReversal` sums `qty × ptr × gst_rate`, and
  `buildGstr3b(…, reversalPaise)` subtracts it → **net ITC** → net payable (SALT-170). Sales
  returns / credit notes still pend the Returns module; per-head set-off is simplified.

## GST liability (live)

`buildGstLiability(currentPeriod, sales, purchases, months=13)` (screen `/gst/liability`,
SALT-069) gives the owner a live tax position without picking a period:

- **Current month** output tax (from `sales_invoices`), eligible ITC (from `purchases`), and
  **net payable** = `max(0, output − ITC)` — the same per-month aggregation as GSTR-3B.
- **Payment due date** = the 20th of the following month (`shiftPeriod(period, 1)` + `-20`);
  the screen shows days remaining / overdue.
- **MoM / YoY** deltas of net payable (vs the previous month and the same month last year) +
  a **13-month trend**. Months are bucketed by document date; a month with no documents reads
  as a null comparison (not a misleading zero). `shiftPeriod(period, n)` is the shared
  month-arithmetic helper. Read-only — filing is SALT-072.

## ITC register & reversal

`buildItcRegister` / `buildItcReversal` (screen `/gst/itc`, SALT-064):

- **Register** — a month's inward invoices from `purchases` (vendor via `ledgers`): vendor,
  GSTIN, invoice, date, taxable, CGST/SGST/IGST + totals (ITC = CGST+SGST+IGST). Same scope as
  GSTR-3B's ITC side (shop, `status='received'`, `posts_effects=true`). CSV export.
- **Reversal pre-calc** — Section 17(5)(h): for **expired stock** (`batches` with `qty>0` and
  `expiry` (YYYY-MM, lexical) before the current month) the ITC to reverse is estimated as
  `round(qty × ptr × gst_rate/100)` from the item's GST rate. **Net ITC** = eligible − reversal.
- Batch→purchase-line attribution is approximate (PTR×rate); advisory — the exact figure would
  ride a returns/adjustment posting.

## Tally export

`buildTallyXml(companyName, sales, purchases)` (screen `/gst/tally`, SALT-070) emits a Tally
**Import Data** envelope of a month's books for the accountant — one **Sales** voucher per bill
and one **Purchase** voucher per GRN, each a balanced double entry carrying the GST split:

- Sale — Dr party/Cash (total) · Cr Sales (taxable) · Cr Output CGST/SGST/IGST.
- Purchase — Dr Purchase (taxable) · Dr Input CGST/SGST/IGST · Cr vendor (total).

Amounts are rupees; `AMOUNT` is negative for debits (Tally's sign convention) so each voucher
sums to zero. Cash/UPI/card bills post to **Cash**, credit bills to the party ledger. Ledgers
are referenced by name (Tally maps/creates them on import). Same scope filters as the returns.

## HSN summary (report)

`buildHsnSummary(lines)` (screen `/gst/hsn`, SALT-068) aggregates sale lines by **HSN × rate**
(qty, taxable, CGST/SGST/IGST) over a **flexible month range** — the same table GSTR-1 §12 shows
for one month, but spanning a quarter or year for GSTR-9 / analytics. CSV export. Same scope as
the returns (shop, `status='placed'`, `posts_effects=true`).

## Status & next

**Shipped** (all in-lane GST filing/insight work): GSTR-1, GSTR-3B (+ Table-4B write-off
reversal), live liability, ITC register, Tally export, HSN summary.

**Newly unblocked** (DB schema landed): **H1/X register** (SALT-065 — `h1_register` /
`enforce_h1_gate` live, migration `0032`) and **multiple GST series per shop** (SALT-067 —
series schema, `0033`).

**Elsewhere / handed off:** GSTR-2B recon (SALT-007, smart-import lane) · the drug-license
renewal banner (SALT-066, owner lane — store + 90/60/30-day alerts already ship in
`settings/DrugLicensesPage`) · e-invoicing IRN/QR (SALT-071) and direct GSTN filing (SALT-072)
await GSP/IRP credentials. Sales credit-note GST reversal rides the Returns engine
(`lib/returns.ts`); the Reports lane also exposes a Tax-reports suite at `/reports/tax` over the
`v_*` views — complementary to these filing screens.

Links: [product/product-modules](../product/product-modules.md) §9 ·
[domain/orders](../domain/orders.md) ·
[decisions/0010](../decisions/0010-gstin-canonical-party-identity.md)
