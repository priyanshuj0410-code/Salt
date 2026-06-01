---
type: architecture
updated: 2026-06-01
tags: [gst, compliance, sales]
---

# GST & compliance — returns, liability, ITC, exports

The **GST & compliance** module's eight screens (SALT-002/063/064/065/067/068/069/070/170; product-modules §9):
read-only views that aggregate one shop's documents into the GSTN sections, a live tax position,
the ITC ledger, accountant exports, and the Schedule H1/X dispensing register — with portal-ready
JSON / CSV / Tally XML / inspector PDF. Screens under `/gst` (`Gstr1Page`, `Gstr3bPage`,
`GstLiabilityPage`, `ItcRegisterPage`, `TallyExportPage`, `HsnReportPage`, `H1RegisterPage`, `InvoiceSeriesPage` in
`components/gst/`); the returns aggregation lives in `lib/gst.ts` and the register in `lib/h1.ts`,
both **pure** (no
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
- **CDNR / CDNUR** — sales-return `credit_notes` for the period (`buildCreditNoteSections`),
  **rate-wise** from `credit_note_lines` and carrying the original invoice ref
  (`sale_invoice_id → invoice_no/date`): CDNR = recipient has a GSTIN; CDNUR = B2C (GSTN note
  type `C`, `itms` per rate). These reduce the outward liability GSTR-3B 3.1(a) nets out (SALT-196).
- Place of supply = recipient `state_code`, falling back to the shop's state for walk-ins.

Section breakdowns and the headline totals both derive from the **lines**, so they reconcile.

## Export

- `buildGstr1Json` → GSTN-shaped `{ gstin, fp, b2b, b2cl, b2cs, hsn }`, merged with
  `creditNoteSectionsToJson` → `{ cdnr, cdnur }` (amounts in rupees, dates `DD-MM-YYYY`,
  `fp = MMYYYY`).
- `gstr1ToCsv` → one flat CSV across all sections; credit notes appended via `creditNotesToCsv`.

## GSTR-3B (summary return)

`buildGstr3b(period, sales, purchases, reversalPaise, creditNotes)` (screen `/gst/gstr3b`) nets the month's tax:

- **Output tax** — summed per head (CGST/SGST/IGST) from the period's `sales_invoices`
  (same scope as GSTR-1: shop, `status='placed'`, `posts_effects=true`).
- **Less: credit notes** — the period's sales-return `credit_notes` per head; **net output**
  = output − credit notes is the actual outward liability reported in 3.1(a) (SALT-196).
- **Gross ITC** — summed per head from `purchases` (`status='received'`,
  `posts_effects=true`, `received_date` in month); `receive_purchase` stores the split the
  same way `create_sales_invoice` does.
- **Net payable** = `max(0, net output − net ITC)` after full credit set-off (the cash figure),
  where net output = output − credit notes and net ITC = gross ITC − the Table-4B reversal below;
  per-head `balance` is shown for detail; surplus ITC is reported as credit carried forward.
- `buildGstr3bJson` → GSTN-style `{ gstin, ret_period, sup_details, itc_elg, net_payable }`;
  `gstr3bToCsv` for spreadsheets.
- **ITC reversal (Table 4B)** is wired from **expiry write-offs** (`stock_movements`,
  `reason='writeoff'`, period-scoped): `buildWriteoffReversal` sums `qty × ptr × gst_rate`, and
  `buildGstr3b(…, reversalPaise)` subtracts it → **net ITC** → net payable (SALT-170). Sales
  returns are now wired (SALT-196): credit notes net the outward side (3.1(a)) and surface as
  CDNR/CDNUR in GSTR-1; per-head set-off is simplified.

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

## H1/X register

`/gst/h1` (`H1RegisterPage`, SALT-065) is the legal Schedule **H1/X dispensing register** for the
drug inspector — `create_sales_invoice` writes an `h1_register` row per H1/X line at checkout
(migration `0032`, carrying the H1 gate's prescriber + patient details). The screen filters by date
range, schedule (H1/X), and a drug/doctor/patient search, resolves the pharmacist via `profiles`,
and exports **CSV** + a print/PDF inspector register (A4 landscape, 3-year-retention footer). The
filter + CSV + register-HTML helpers live in **`lib/h1.ts`** (pure, smoke-tested); `printH1Register`
is the thin `window.print()` wrapper (same pattern as `lib/destruction.ts`).

## Invoice series

`/gst/series` (`InvoiceSeriesPage`, SALT-067) manages a shop's **named GST invoice series**
(`invoice_series`, 0024 + 0033 — `code` / `prefix` / `number_width` / `is_default` / `active`,
RLS-CRUDable). Add a series (RETAIL / WS / branch), set the **default**, edit prefix/width, and
activate/deactivate — per Indian financial year. The running number is allocated **gap-free**
server-side by `next_doc_no(shop, 'sales_invoice', code)`, and `create_sales_invoice` pulls from
the shop's default active series (so changing the default re-routes new bills immediately). Pure
helpers (`currentIndianFy`, `seriesPreview`, `normalizeSeriesCode`) in **`lib/series.ts`**
(smoke-tested). The per-bill series **picker at the counter** is the billing lane's half — filed
as **SALT-209**.

## Status & next

**Shipped** (all in-lane GST work — 10 tickets): GSTR-1 (+ **CDNR/CDNUR** credit notes), GSTR-3B
(+ Table-4B write-off reversal **+ net-output credit-note netting**, SALT-196), live liability,
ITC register, Tally export, HSN summary, the **H1/X register** (SALT-065, on the live
`h1_register` / 0032), and **invoice-series management** (SALT-067, on `invoice_series` / 0033).

**Elsewhere / handed off:** GSTR-2B recon (SALT-007, smart-import lane) · the drug-license
renewal banner (SALT-066, owner lane — store + 90/60/30-day alerts already ship in
`settings/DrugLicensesPage`) · e-invoicing IRN/QR (SALT-071) and direct GSTN filing (SALT-072)
await GSP/IRP credentials. Sales returns are recorded by the Returns engine (`lib/returns.ts`) as
`credit_notes`; the GST module reads those into GSTR-1 CDNR/CDNUR and the GSTR-3B net output
(SALT-196). The Reports lane also exposes a Tax-reports suite at `/reports/tax` over the `v_*`
views — complementary to these filing screens.

Links: [product/product-modules](../product/product-modules.md) §9 ·
[domain/orders](../domain/orders.md) ·
[decisions/0010](../decisions/0010-gstin-canonical-party-identity.md)
