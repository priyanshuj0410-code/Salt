---
type: architecture
updated: 2026-06-01
tags: [inventory, stock, expiry, dead-stock, reorder, adjustments, itc]
---

# Inventory

The real-time view of **what is in stock** and the operations that **mutate** it.
The counterpart to [GRN/purchase](grn.md) (inbound) and the [billing screen](billing-screen.md)
(outbound): both write the stock ledger, inventory reads it back as on-hand,
near-expiry, dead stock, reorder, turnover — and writes corrections, counts, and
expiry write-offs. Per [product-modules §4 + §11](../product/product-modules.md).

Read views + their data layer are pure frontend (`lib/inventory.ts`, `components/inventory/`);
the write paths add one migration (`0028`, two RPCs). Nav module `i` (`g i`), all nine
sub-views built.

## The stock ledger (model)

> ⚠️ **Stale-wiki flag.** The stock backbone is the [proposed model](proposed-data-model.md)
> (`supabase/proposed/0016_inventory_backbone.sql`), **applied** despite the "DO NOT RUN"
> label — same situation [grn.md](grn.md)/[gst-returns.md](gst-returns.md) found.
> [data-model.md](data-model.md) (migrations 0001–0013) predates it. Verified live by
> PostgREST probe 2026-06-01. Reconciling data-model.md is its own ticket.

- **`stock_movements`** — the immutable, signed audit trail of every quantity change:
  `org_id, shop_id, item_id, batch_id, qty_delta (signed), reason ∈ {sale, sale_return,
  purchase, purchase_return, transfer_in, transfer_out, adjustment, writeoff, opening},
  unit_cost_paise, ref_table, ref_id, note, created_by, created_at`.
- **`batches`** — `batches.qty` is a **cached current-on-hand** the document RPCs keep in
  step (every RPC that moves stock writes a movement *and* updates `qty`). Plus `expiry`
  (free text, captured verbatim), **`expiry_date`** (parsed date, 0016), `mrp_paise`,
  `ptr_paise` (cost), `shop_id` (0014, backfilled).
- **`items`** — base master (0004) + the 0015 retail fields used here: `reorder_level`,
  `is_active`, `pack`, `pack_size`, `therapeutic_category`, `gst_rate`, `schedule`.
- **`physical_counts` / `physical_count_lines`** — stock-take documents; the line's
  `variance` is a generated column (`counted_qty − system_qty`).

The 0016 design intent holds: **all inventory reports read `stock_movements`** for movement
history, `batches.qty` for on-hand.

## Read-side data layer — `lib/inventory.ts`

One hook, two shapes. **`useInventory()`** does a single `batches`+`items` embed fetch and a
bounded fetch of the last **`LOOKBACK_DAYS = 180`** of `reason in (sale, sale_return)`
movements, then derives:

- **`EnrichedBatch[]`** (per batch) — `expiryAt` (parsed), `daysToExpiry`, `bucket`,
  `costValuePaise` (qty×ptr), `mrpValuePaise` (qty×mrp). For the ledger + near-expiry.
- **`ItemAgg[]`** (per item, folded across its batches + sale movements) — `onHand`,
  `costValuePaise`, `mrpValuePaise`, `avgPtrPaise`/`lastMrpPaise` (max over batches),
  `soldUnits` (net = sale − return, in window), `cogsWindowPaise` (Σ sold×unit_cost),
  `lastSoldAt`, `velocityPerDay`. For dead-stock / reorder / out-of-stock / turnover.

It exposes `reload()` so write screens refresh after a mutation. The arithmetic lives in
**pure, smoke-tested helpers** (no React/Supabase): `parseExpiry` (prefers `expiry_date`,
falls back to Marg free-text `MM/YY`, `MMM-YY`, `YYYY-MM`… and rounds to **end-of-month**,
the pharma convention — a strip is usable through its expiry month), `expiryBucket`
(expired / ≤30 / 31–60 / 61–90 / fresh), `deadStock(n)`, `reorderList` + `suggestedOrderQty`
(cover-days × velocity, floored to the reorder gap), `outOfStock` + `lostSalesEstimate`
(velocity × idle days, valued at last MRP), `turnoverBy` + `turnoverRatio` (annualised
COGS ÷ on-hand cost value).

## Read views (`components/inventory/`)

| Route | Screen | What it surfaces |
|---|---|---|
| `/inventory` | **StockLedgerPage** | qty per item×batch, expiry chip, MRP, cost, value; search; SKU/batch/value StatCards |
| `/inventory/near-expiry` | **NearExpiryPage** | 30/60/90-day windows, sort by soonest or value-at-risk (MRP); expired count |
| `/inventory/dead-stock` | **DeadStockPage** | on-hand items with no sale in N days; capital tied up at cost |
| `/inventory/reorder` | **ReorderPage** | items ≤ reorder_level + velocity-based suggested order qty and est. cost |
| `/inventory/out-of-stock` | **OutOfStockPage** | zero-on-hand items with demand; last-sold + est. lost units/revenue |
| `/inventory/turnover` | **TurnoverPage** | annualised turns by item / category / manufacturer |

A shared `InventoryNav` tab strip switches between all nine views; `StockBits.tsx` holds the
shared `ExpiryCell`.

## Write-side — RPCs (`supabase/migrations/0028_inventory_write.sql`)

Both mirror [`receive_purchase`](grn.md): security-definer, resolve org from `memberships`,
post a signed `stock_movement` **and** keep `batches.qty` in step, atomically.
**The movement row is the audit trail** (reason + note + `created_by` + `created_at`).
No GL entry — purchases are expensed at receipt (periodic inventory), so stock corrections
don't post to the ledger; the lone exception is the destruction ITC reversal (below).

- **`adjust_stock(p_batch_id, p_qty_delta, p_reason, p_note)` → movement id.** `p_reason ∈
  {adjustment, writeoff}`; `p_qty_delta` signed; on-hand may not go below zero (raises).
  Locks the batch (`for update`), confirms org ownership, falls back to the primary shop if
  the batch has no `shop_id`.
- **`finalize_physical_count(p_count_id)` → lines adjusted.** For each draft line with
  `variance ≠ 0`: set `batches.qty = counted_qty` and post an `adjustment` movement of the
  variance (`ref_table='physical_count', ref_id=count`); mark the count `finalized`. Count
  lines are inserted/edited **client-side** (RLS-gated) while a draft; only the posting is
  centralised.
- **`receive_transfer(p_from_shop, p_to_shop, p_lines, …)` → transfer id** (migration `0030`).
  Moves stock between two shops in one org: locks + decrements the source-shop batch,
  increments (or creates) the matching destination-shop batch (same item + batch_no, carrying
  expiry/MRP/PTR), records `stock_transfers` + `stock_transfer_lines`, and posts paired
  `transfer_out` / `transfer_in` movements. Guards: shops differ, both in org, sufficient
  source on-hand.

## Write screens

- **AdjustmentsPage** (`/inventory/adjustments`, SALT-040) — a record dialog (searchable
  on-hand batch picker, reason chips → breakage/theft/expiry/found/correction, signed-qty
  preview, note) over a live **audit log** of adjustments/write-offs. The DB reason is
  `adjustment|writeoff`; the human reason is preserved in the note (`lib/adjustments.ts`,
  `adjustmentNote`).
- **PhysicalCountPage** (`/inventory/count`, SALT-039) — start a count → snapshots on-hand
  batches as lines; an editable sheet with live variance; Save (persist counted) and
  Finalize (RPC). Past counts list; finalized counts read-only (`lib/physicalCount.ts`).
- **ExpiryDestructionPage** (`/inventory/destruction`, SALT-044) — select expired (opt.
  ≤30-day) batches, set qty, capture witness + method. **ITC reversal pre-computed** per
  batch (`itcReversalPaise = qty × ptr × gst_rate/100`, CGST §17(5)(h)); recording writes
  off via `adjust_stock(writeoff)` (reversal + witness in the note) and opens a printable,
  witnessed **Certificate of Destruction** (`lib/destruction.ts`, `window.print` like
  [printInvoice](billing-screen.md)).
- **TransfersPage** (`/inventory/transfers`, SALT-042) — From/To shop pickers, a searchable
  picker over the **source shop's** on-hand batches, per-line qty (capped at available), and a
  transfer history. Calls `receive_transfer` (`lib/transfers.ts`); graceful single-shop empty
  state pointing at Settings → Shops. Unblocked once multi-shop management shipped (SALT-090).

## Contract for other modules

- **GST/ITC** ([gst-returns.md](gst-returns.md)): the destruction ITC reversal is computed
  + shown + noted on the write-off movement + printed — but feeding it into **GSTR-3B** as a
  structured ITC-reversal line is the GST lane's job (filed **SALT-170**). The existing ITC
  register already reads expired-stock movements.
- **Billing** ([billing-screen.md](billing-screen.md)): FEFO consumes `batches` by
  `expiry_date`; each sale posts a `reason='sale'` movement — the velocity/dead-stock source.
- **GRN** ([grn.md](grn.md)): each receipt posts `reason='purchase'`; the inbound side of the
  same ledger.

## Reassigned out of the lane

The two remaining backlog items are owned by other modules, not inventory:

- **SALT-041** Atomic multi-counter stock (no over-commit) → **billing** lane. The no-oversell
  guarantee lives in the sale RPC (`create_sales_invoice`) — a batch row-lock / `qty ≥ 0`
  guard — and the live cross-counter reflection rides the [realtime substrate](realtime.md)
  (SALT-104), not an inventory screen.
- **SALT-045** Cold-chain flag + IoT temp-log hook → **catalogue** lane. `cold_chain` is an
  `items`-master attribute, edited on the `/catalogue` item screen; inventory can then surface
  a cold-chain badge/filter on the stock ledger. The IoT temperature log is a future hook.

## Related
[product/product-modules §4](../product/product-modules.md) · [grn](grn.md) ·
[billing-screen](billing-screen.md) · [gst-returns](gst-returns.md) ·
[proposed-data-model](proposed-data-model.md) · [schema](schema.md) ·
[decisions/0009](../decisions/0009-target-data-model.md)
