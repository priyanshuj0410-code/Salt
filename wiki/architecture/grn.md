---
type: architecture
updated: 2026-06-01
tags: [grn, purchase, inventory, itc, gst]
---

# GRN / Purchase (goods receipt)

The **inbound** side of inventory (product-modules §3): when stock arrives from a vendor it
is received here, which (1) **adds stock** — including scheme free goods, (2) raises the
**vendor payable**, and (3) records **ITC** (input tax credit) on the GST paid. The
counterpart to the [billing screen](billing-screen.md) (outbound) and the source the
[GSTR-1/ITC](gst-returns.md) and payables reporting read from.

Screens under `components/grn/`; pure economics in `lib/grn.ts`; the RPC contract in
`lib/orders.ts`. **Frontend-only build — no migration**: the backbone was already live.

## Read/write contract (as-built)

> ⚠️ **Stale-wiki flag.** The live purchase tables — **`purchases` / `purchase_lines` /
> `purchase_orders` / `po_lines`** + the **`receive_purchase`** RPC — are the
> [proposed model](proposed-data-model.md) (`supabase/migrations/0019_purchases.sql`), which
> has been **applied** despite still being labelled "DO NOT RUN". [data-model.md](data-model.md)
> still describes purchases as `orders`/`order_lines` + `place_order` (migrations 0010/0011);
> that is the old model. Verified by live column-probing on 2026-06-01. Same situation the
> [GSTR-1 slice](gst-returns.md) found for sales (`sales_invoices`/`sale_lines`). Full
> reconciliation of data-model.md is its own ticket.

**`purchases`** (GRN header) — `org_id, shop_id, vendor_id (FK ledgers, RESTRICT), po_id?,
grn_no, vendor_invoice_no, vendor_invoice_date, received_date, is_interstate,
subtotal_paise, discount_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise,
round_off_paise, total_paise, paid_paise, status ∈ {draft,received,cancelled}, notes,
created_by`.

**`purchase_lines`** — `purchase_id, po_line_id?, item_id (FK, nullable), name, batch_no,
expiry, qty, free_qty, ptr_paise (cost/unit, tax-exclusive), mrp_paise, discount_type,
discount_value, scheme_text, taxable_paise, gst_rate, cgst_paise, sgst_paise, igst_paise,
line_total_paise`.

**`purchase_orders` / `po_lines`** — optional pre-GRN PO (`status ∈ {draft,sent,partial,
received,closed,cancelled}`). Present but **not yet surfaced** (Phase 2 — see below).

## `receive_purchase` RPC

```
receive_purchase(
  p_shop_id uuid, p_vendor_id uuid,
  p_vendor_invoice_no text, p_vendor_invoice_date date,
  p_payment_method text, p_credit_days integer,
  p_lines jsonb,
  p_po_id uuid = null, p_grn_no text = null, p_notes text = null
) returns uuid           -- the new purchase (GRN) id
```

`p_lines[]` = `{item_id, name, batch_no, expiry, qty, free_qty, ptr_paise, mrp_paise,
discount_type, discount_value, gst_rate, taxable_paise, scheme_text}`. Security-definer;
resolves org from `memberships`; vendor + shop must be in the org. Per line it:

- **taxable** = the `taxable_paise` sent if present, **else** `qty × ptr` — so trade
  discounts only land if the client computes and sends taxable. (We do — via `computeGrnLine`.)
- **tax** = `round(taxable × rate/100)`; **split** by place of supply: intra-state →
  `cgst = tax/2` (Postgres **integer** division, i.e. floor), `sgst = tax − cgst`;
  inter-state → all `igst`. `is_interstate` is derived server-side from vendor vs shop
  `state_code`.
- **stock** += `qty + free_qty` — free goods enter stock (upsert the `(shop,item,batch)`
  batch, refresh ptr/mrp/expiry) and a `purchase` row is written to `stock_movements`.
- **payable**: cash/card/upi/bank ⇒ `paid_paise = total`; credit ⇒ unpaid, `due_date =
  today + credit_days`.
- **double entry** (`ledger_entries`, see [decisions/0009](../decisions/0009-target-data-model.md)):
  Dr Purchase + Dr CGST/SGST/IGST input (ITC) = Cr vendor (or Cr cash/bank if paid).
- If `p_po_id` given, marks that PO `received`.

**Pre-flight:** the shop must have a `state_code` or the insert trips `is_interstate NOT
NULL`. `GrnEntryPage` guards via `useShopBlockers()` and the `ShopSetupDialog` rescue
(same pattern as billing), retrying the save on resolve.

## Economics — `lib/grn.ts` (pure)

The inverse of retail: purchases are **tax-exclusive** (GST on top of PTR), where sales are
MRP-inclusive (`splitInclusiveGst` in `currency.ts`). Mirrors the RPC exactly so what the
user sees equals what is stored.

- `computeGrnLine(line, interstate)` → `{ grossPaise, discountPaise, taxablePaise, cgstPaise,
  sgstPaise, igstPaise, gstPaise, lineTotalPaise, stockQty, effectiveCostPaise }`.
  - `taxable = qty×ptr − discount`; `gst = round(taxable × rate/100)`; CGST uses
    **`Math.floor(gst/2)`** to match the server's integer division, SGST takes the remainder.
  - `stockQty = qty + freeQty`; **`effectiveCostPaise = taxable / stockQty`** — the
    "10+1 lowers your real cost" number (free goods carry zero ITC but real stock).
- `grnTotals(lines, interstate)` → document totals **with a per-GST-rate breakup**
  (`byRate[]`) for the multi-rate footer and ITC/GSTR-2 reporting.
- `grnLineDiscount(gross, type, value)` — "pct" of gross or "flat" paise, capped at gross.
- `isInterstate(vendorStateCode, shopStateCode)` — place of supply; unknown vendor state ⇒
  intra (matches the server, which can't split what it doesn't know).

## Screens (`components/grn/`)

- **`GrnEntryPage`** (`/purchases/new?vendor=:id`) — receive stock. Vendor picker
  (`VendorPicker`, preselects from `?vendor=`), vendor-invoice no + date, a line grid with
  **free qty / trade-disc % / MRP**, live per-line **effective cost + GST**, and a footer
  with the **multi-rate GST breakup**, grand total, and ITC claimable. Saves via
  `buildReceivePurchasePayload` → `receive_purchase`, then routes to the new GRN's detail.
- **`CreateItemDialog`** — **no silent add** (SALT-019): an item not in the catalogue is
  created explicitly (name, salt, manufacturer, pack, HSN, GST%, schedule) → `insert` into
  `items` (org-scoped; `items` has **no** `shop_id`), then dropped onto the GRN and into the
  `useCatalog` store via `upsertItem`.
- **`GrnListPage`** (`/purchases`) — history (date, vendor, ref, taxable, ITC, total) +
  StatCards (GRNs, taxable, ITC). **`GrnDetailPage`** (`/purchases/:id`) — read-only header +
  lines + totals.

Nav: the **Purchases** module is `built: true` (`navConfig.ts`), `g p` shortcut. Reached
also from a vendor profile's **New purchase** button (`/purchases/new?vendor=`).

## Contract for other modules

- **GST/ITC** ([gst-returns.md](gst-returns.md)): per-line `cgst_paise/sgst_paise/igst_paise`
  on `purchase_lines` (and the header totals) are the **ITC claimable** — the input side of
  GSTR-3B and the basis for GSTR-2B reconciliation. Free goods contribute **zero** ITC.
- **Inventory/Returns**: each receipt writes `stock_movements (reason='purchase')`; a purchase
  return (debit note) will reverse stock + pre-compute the ITC reversal off these line splits.
- **Payments**: a credit GRN raises the vendor payable; `record_payment(direction='paid')`
  settles it (already built on the party profile).

## Not built yet (Phase 2 — SALT-021…024)

Manual **PO**, auto-PO (reorder level + sales velocity), send PO (WhatsApp/PDF), and
**GRN↔PO↔invoice matching** with discrepancy flags. The `purchase_orders`/`po_lines` tables
and `receive_purchase`'s `p_po_id` already exist to hang these on. Debit notes (purchase
returns) belong to the Returns module.

## Related
[product/product-modules §3](../product/product-modules.md) · [billing-screen](billing-screen.md) ·
[gst-returns](gst-returns.md) · [data-model](data-model.md) · [proposed-data-model](proposed-data-model.md) ·
[domain/orders](../domain/orders.md) · [decisions/0009](../decisions/0009-target-data-model.md)
