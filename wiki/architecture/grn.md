---
type: architecture
updated: 2026-06-03
tags: [grn, purchase, inventory, itc, gst, po, returns, ocr, schemes, csv, dedup]
---

# GRN / Purchases (goods receipt)

The **inbound** side of inventory (product-modules §3): stock arriving from a distributor is
received here, which (1) **adds stock** — including scheme free goods, (2) raises the
**vendor payable**, and (3) records **ITC** (input tax credit) on the GST paid. The
counterpart to the [billing screen](billing-screen.md) (outbound), and the source the
[GSTR-1 / ITC](gst-returns.md) and payables reporting read from.

Now a full subsystem, not just a receive screen: purchase orders, auto-PO, GRN↔PO↔invoice
matching, debit notes (purchase returns), vendor schemes, and OCR invoice capture all ship.
Screens under `components/grn/`; pure economics in `lib/grn.ts`; RPC contracts in
`lib/orders.ts`.

## What shipped

| Capability | Tickets |
|---|---|
| Receive into stock (GRN) + history/detail | SALT-001, 020 |
| Scheme/free-qty (10+1) → effective cost + multi-rate ITC | SALT-018 |
| New-item review (no silent add) | SALT-019 |
| Manual PO · auto-PO (reorder + velocity) · send PO | SALT-021, 022, 023 |
| GRN↔PO↔invoice matching + discrepancy flags | SALT-024 |
| Debit note (purchase return) → stock/payable down, ITC reversal | SALT-025, 190 |
| Vendor scheme log + price list (auto-apply + flag) | SALT-026 |
| Bulk GRN from invoice PDF/OCR + scan audit/retry | SALT-027, 221 |
| Line GST by vendor invoice date (rate schedule) | SALT-212 |
| Adopt the ActionBar primitive | SALT-220 |
| OCR/CSV: PTR-vs-PTS auto-detect + store both rates | #257, #262 |
| CSV importer → AI fallback for odd layouts | #259 |
| Dedup — skip already-imported invoices | #260 |
| Delete a scan · fully reverse + delete its GRN | #258, #261 |
| Multi-file → background extraction | #263 |

## Data model (as-built)

> The purchase tables and `receive_purchase` were authored in the "proposed" model and have
> since been **promoted to canonical migrations** (`supabase/migrations/0019_purchases.sql`,
> SALT-140) and applied — verified by live column-probing. [data-model.md](data-model.md)
> still describes the *old* `orders`/`order_lines` shape; full reconciliation of that page is
> its own ticket.

- **`purchases`** (GRN header, `0019`) — `org_id, shop_id, vendor_id (FK ledgers RESTRICT),
  po_id?, grn_no, vendor_invoice_no, vendor_invoice_date, received_date, is_interstate,
  subtotal/discount/taxable/cgst/sgst/igst/round_off/total/paid _paise, status ∈
  {draft,received,cancelled}, notes, created_by`.
- **`purchase_lines`** (`0019` + `0059`) — `purchase_id, po_line_id?, item_id (FK, nullable),
  name, batch_no, expiry, qty, free_qty, ptr_paise (**printed PTR**), pts_paise (**printed
  PTS**), cost_basis ∈ {ptr,pts}, mrp_paise, discount_type, discount_value, scheme_text,
  taxable_paise, gst_rate, cgst/sgst/igst_paise, line_total_paise`. Both printed rates are kept
  (`0059`); the **landed cost** (stock valuation + taxable) is `cost_basis === 'pts' ? pts_paise
  : ptr_paise`.
- **`purchase_orders` / `po_lines`** (`0019`) — pre-GRN PO (`status ∈ {draft,sent,partial,
  received,closed,cancelled}`); `receive_purchase(p_po_id)` marks it received.
- **`debit_notes` / `debit_note_lines`** (`0020`) — purchase returns; each line keeps
  `purchase_line_id` so the returnable balance is cumulative across notes. See [returns](returns.md).
- **`vendor_schemes`** (`0039`, SALT-026) — per-vendor (optionally per-item) trade-discount /
  buy-qty+free-qty schemes with validity dates + an `active` flag.
- **`invoice_scans`** (`0049` + `0060`, SALT-221) — one row per OCR upload (`status ∈ {pending,
  processing,extracted,failed,posted,duplicate}`, `extracted_json`, `vendor_guess`, `error`,
  `purchase_id?`, `batch_id?` grouping one multi-file upload), plus a private **`invoice-scans`
  Storage bucket** (RLS keyed on the `{org_id}/…` path).
- **`gst_rate_schedule`** (`0046`, SALT-081) — date-ranged GST rates per `rate_class`
  (`std/ayush/nil/gst18`); reference data, authenticated-read.

## RPCs

- **`receive_purchase(p_shop_id, p_vendor_id, p_vendor_invoice_no, p_vendor_invoice_date,
  p_payment_method, p_credit_days, p_lines jsonb, p_po_id?, p_grn_no?, p_notes?) → uuid`**
  (cumulative `0019 → 0046` owner-guard `→ 0059` PTR/PTS). Stores both printed rates +
  `cost_basis`; the **landed cost** for stock/taxable is the cost_basis rate. Per line:
  **taxable** = sent `taxable_paise` (so trade discounts land) else `qty × cost`; **tax** =
  `round(taxable × rate/100)`, split by place of
  supply — intra → `cgst = tax/2` (Postgres **integer** division = floor), `sgst = tax − cgst`;
  inter → all `igst`. Adds `qty + free_qty` to the `(shop,item,batch)` batch + a `purchase`
  `stock_movements` row; raises the payable (or pays it for cash/card/upi/bank); posts the
  double entry (Dr Purchase + Dr GST input = Cr vendor). `is_interstate` is derived from
  vendor vs shop `state_code`.
- **`create_debit_note(...)`** (`0020`, owner-guarded `0046`) — reverses stock, lowers the
  payable (or refunds cash/bank), reverses ITC. Driven by the effective-cost engine; trusts
  the client's per-line `taxable_paise` so the reversal equals what the UI showed.
- **`gst_rate_for(p_class text, p_on date) → numeric`** (`0046`) — the rate in force on a
  date (latest schedule range containing it). The client mirrors it (below) for live defaults.
- **`delete_purchase(p_purchase_id) → void`** (`0058`, owner-only) — fully reverses a GRN:
  subtracts the received + free stock from the batch, deletes the purchase's `ledger_entries`
  (payable + ITC) and `stock_movements`, and deletes the purchase (lines cascade; `debit_notes` /
  `invoice_scans` links null out). **Stock is allowed to go negative** on purpose — a below-zero
  on-hand after a delete flags an already-sold item whose purchase invoice is now missing.

## Economics — `lib/grn.ts` (pure)

The inverse of retail: purchases are **tax-exclusive** (GST on top of PTR), where sales are
MRP-inclusive (`splitInclusiveGst` in `currency.ts`). Mirrors the RPC exactly so what the
user sees equals what is stored.

- `computeGrnLine(line, interstate)` → `{ grossPaise, discountPaise, taxablePaise,
  cgst/sgst/igst/gstPaise, lineTotalPaise, stockQty, effectiveCostPaise }`. `taxable =
  qty×ptr − discount`; CGST uses **`Math.floor(gst/2)`** to match the server; `stockQty =
  qty + freeQty`; **`effectiveCostPaise = taxable / stockQty`** — the "10+1 lowers your real
  cost" number (free goods carry zero ITC but real stock).
- `grnTotals(lines, interstate)` → document totals with a **per-GST-rate breakup** (`byRate[]`)
  for the multi-rate footer and ITC reporting.
- `isInterstate(vendorStateCode, shopStateCode)` — place of supply; unknown vendor state ⇒
  intra (matches the server).
- **Vendor schemes** (SALT-026): `activeSchemeFor`, `schemeFreeQtyFor`, `schemeMismatch` —
  auto-apply the vendor's active scheme to a new line (seed free qty + trade discount) and
  flag a line that diverges from it.
- **PO / matching**: `suggestReorders` (reorder level + sales velocity → auto-PO, SALT-022),
  `matchGrnToPo` + `discrepancyLabel` (ordered vs received, SALT-024), `formatPoText` /
  `poTotal` / `buildPoLineRows` (PO share text, SALT-023).
- **Returns** apportionment lives in [`lib/returns.ts`](returns.md) (SALT-099), adopted by the
  debit-note screen in SALT-190 — not duplicated here.

**Date-effective GST (SALT-212).** Each item carries its master `gstRateClass` (from
`master_items`, embedded by the catalog store, which also loads the 6-row `gst_rate_schedule`
once). `gstRateForClass(class, date, schedule)` in `lib/gstSchedule.ts` (mirrors the SQL
`gst_rate_for`) resolves the in-force rate; `GrnEntryPage` defaults each new line to the rate
on the **vendor invoice date** — correct ITC for back-dated GRNs and around the 22-Sep-2025
12%→5% medicine cutover — with a per-line **GST %** column to override an unexpected billed
rate. Falls back to the item's own rate when unlinked.

**PTR vs PTS (`resolvePurchaseRate`, lib/importPurchaseInvoice.ts).** Pharma bills often print
both Price-To-Retailer and Price-To-Stockist; the line value is computed from only one.
`resolvePurchaseRate` reconciles each rate's `qty·rate·(1−disc)` against the printed line
**amount** (within 5%) to pick the billed one, derives the rate from the amount if neither
matches, and returns the billed cost **plus both printed rates + the basis** — so nothing is
lost and the importers + `receive_purchase` store the full picture. Shared by OCR + CSV; the
review flags PTS / derived / ambiguous lines.

**Dedup (`findExistingInvoice`, lib/purchaseDedup.ts).** Both importers check each extracted
invoice number against posted GRNs (`purchases.vendor_invoice_no`, lenient vendor match), badge
duplicates with the existing GRN ref, and exclude them from posting — a bill can't be captured twice.

## Screens (`components/grn/`)

- **Receive + history** — `GrnEntryPage` (`/purchases/new`): vendor picker, invoice no/date,
  a line grid with free qty / trade-disc % / **GST %** / MRP, live per-line effective cost +
  GST, an [ActionBar](#decisions--gotchas) footer (total · lines · ITC) and the multi-rate
  breakup. `GrnListPage` (`/purchases`) + `GrnDetailPage` (`/purchases/:id`). `CreateItemDialog`
  — **no silent add** (SALT-019): an unknown item is created explicitly, then dropped onto the
  GRN and into the `useCatalog` store.
- **Purchase orders** — `PoEntryPage` / `PoListPage` / `PoDetailPage`, `AutoPoPage`
  (reorder-level + velocity suggestions), `SendPoDialog` (share as text via WhatsApp/email/copy;
  distributor-API submission is the planned channel — [decisions/0016](../decisions/0016-vendor-ordering-channel.md)).
  Receiving against a PO is `/purchases/new?po=:id` → prefilled grid + a match banner.
- **Returns (debit notes)** — `DebitNoteEntryPage` (`/purchases/returns/new?purchase=:id`),
  `DebitNoteListPage`, `DebitNoteDetailPage`. Driven off the originating GRN's lines with a
  cumulative returnable cap; economics from [returns.md](returns.md).
- **Vendor schemes** — `VendorSchemesPage` + `SchemeDialog` (CRUD the scheme/price list).
- **OCR import** — `OcrInvoiceImportPage` + `InvoiceScansPage` (below).

Nav: **Purchases** module `built: true` (`navConfig.ts`), `g p` shortcut; also reached from a
vendor profile's **New purchase** button.

## OCR invoice capture (SALT-027 / 221)

Upload a distributor invoice (PDF/image) → the **`extract-invoice` Edge Function** asks
**Google Gemini** for strict JSON of the header + lines → `lib/ocrInvoice.ts:ocrInvoiceToRows`
maps it to the CSV-importer row shape (`normalizeExpiry` fixes `MM/YYYY`→`YYYY-MM`) →
`parsePurchaseInvoices` dry-run → posts each invoice via `receive_purchase`, auto-creating
missing vendors/items. Reuses the whole CSV-import path — no duplicate posting logic.

- **Reliability:** the function walks a **model-fallback chain** with backoff retry on 503/429
  (free-tier capacity shedding); the durable fix for sustained 503s is enabling billing on the
  key. The vision key (`GEMINI_API_KEY`) is a server-side Supabase secret only.
- **Audit/retry (SALT-221):** every upload persists its file to the private `invoice-scans`
  bucket + an `invoice_scans` row *before* OCR, so a failed/interrupted scan is on record and
  retried from storage (`InvoiceScansPage`) instead of re-uploading; a posted scan links to its
  GRN. Scan history also supports **delete** (`deleteScan` → `delete_purchase` for a posted scan).
  Helpers in `lib/invoiceScans.ts`.
- **Robust JSON (#257):** `parseModelJson` brace-matches the **first complete object** from the
  model reply (tolerating trailing prose / a second object Gemini sometimes appends).
- **CSV → AI fallback (#259):** the CSV importer runs the deterministic column parser first;
  only when it yields no valid invoice does the CSV text go to `extract-invoice` (which now
  accepts a `text/*` part) to normalise an arbitrary layout — free for clean files, AI rescue
  for messy ones.
- **Multi-file background (#263):** selecting several files uploads each as a `pending` scan
  (shared `batch_id`) and fires the **`process-scans`** Edge Function — a service-role worker
  that drains the org's pending scans server-side (so work survives the user leaving), reusing
  `extract-invoice` per file and marking `extracted` / `duplicate` / `failed`. **Extract-only** —
  the user reviews + posts from scan history.

## Decisions & gotchas

- **Shop state is mandatory.** `is_interstate = NOT(intra)` becomes NULL (→ NOT-NULL violation)
  when the shop has no `state_code` but the vendor does. All purchase entry points
  (`GrnEntryPage`, `DebitNoteEntryPage`, OCR + CSV import) guard via `useShopBlockers()` and the
  just-in-time **`ShopSetupDialog`**, which collects the state inline and retries the save.
- **Money is integer paise** everywhere ([decisions/0003](../decisions/0003-money-as-paise.md)).
- **ActionBar (SALT-220)** — `GrnEntryPage` + `DebitNoteEntryPage` are the first adopters of the
  shared `components/patterns/action-bar` primitive (sticky thumb bar on mobile, static footer
  on `md+`); [decisions/0015](../decisions/0015-dual-modality-interaction.md). The counter
  keeps its richer bespoke `BillSummary`/`MobileCheckout`.
- **Background can't post.** `receive_purchase` / `create_debit_note` resolve org + owner +
  `created_by` from `auth.uid()`, so the `process-scans` worker stops at extraction — posting
  stays user-driven (also the safe choice given OCR can misread). A deleted GRN deliberately
  allows **negative stock** as a missing-invoice signal.

## Contract for other modules

- **GST/ITC** ([gst-returns.md](gst-returns.md)): per-line `cgst/sgst/igst_paise` on
  `purchase_lines` are the **ITC claimable** (input side of GSTR-3B / basis for GSTR-2B). Free
  goods contribute **zero** ITC.
- **Inventory**: each receipt writes `stock_movements (reason='purchase')`; a debit note
  reverses it.
- **Payments**: a credit GRN raises the vendor payable; `record_payment(direction='paid')`
  settles it (party profile).

## Current state vs planned

All product-modules §3 items are live, plus the OCR/CSV import hardening (PTR/PTS, AI fallback,
dedup, multi-file background extraction) and GRN delete. Open follow-ups: a token-saving
header-only pre-call + a pg_cron drain for the scan worker; distributor-API PO submission (vs the
shipped WhatsApp/email/text share); GSTR-2B auto-reconciliation against supplier filings; and
reconciling [data-model.md](data-model.md) to the as-built `purchases` shape.

## Related
[product/product-modules §3](../product/product-modules.md) · [returns](returns.md) ·
[billing-screen](billing-screen.md) · [gst-returns](gst-returns.md) ·
[data-model](data-model.md) · [domain/orders](../domain/orders.md) ·
[decisions/0009](../decisions/0009-target-data-model.md) ·
[decisions/0016](../decisions/0016-vendor-ordering-channel.md)
