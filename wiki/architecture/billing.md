---
type: architecture
updated: 2026-06-02
tags: [billing, counter, sales, pos]
---

# Billing module

The billing module (`apps/web/src/components/billing/`, `store/bill.ts`, `store/catalog.ts`,
`store/heldBills.ts`, and a cluster of `lib/*.ts`) is the **counter sale surface** — Salt's core
revenue path and the only screen a cashier role can reach (the default `/` route). It turns a
search-and-add bill into an atomic, GST-compliant `sales_invoices` row via one server RPC.

This page is the **module hub**: the write-path contract, the client architecture, and the
feature map with current-vs-planned. For the on-screen layout, keyboard map, and per-component
detail see **[billing-screen](billing-screen.md)**. Vision/scope: `salt-prd-v0.3.md` §6 (Billing).

## The write path — `create_sales_invoice` (the contract)

Every saved bill goes through the single RPC `create_sales_invoice`. The client never writes
`sales_invoices` / `sale_lines` / `batches` directly — it builds one payload
([`buildSalesInvoicePayload`](../../apps/web/src/lib/orders.ts)) and the function does the
ledger, stock, and tax work **atomically** server-side. Money is **integer paise** throughout;
the server **recomputes the GST split from `line_total_paise`** so the client and server can
never disagree (see [Decisions](#decisions--gotchas)).

`create_sales_invoice` is a **cumulative `create or replace` chain** — each migration re-declares
the whole function carrying forward all prior logic, so they must be applied in order and any new
slice must preserve the earlier behaviour:

| Migration | Added to the RPC | Client ticket |
|---|---|---|
| [`0018_sales`](../../supabase/migrations/0018_sales.sql) | Base: invoice + lines + FEFO-ish batch decrement, inclusive-GST split, party ledger posting | — |
| [`0032_h1_enforcement`](../../supabase/migrations/0032_h1_enforcement.sql) | Server `enforce_h1_gate` + `record_h1_entry` (0022) wired in — rejects a non-compliant Schedule H1/X sale, writes `h1_register` atomically | SALT-005 / 185 |
| [`0033_invoice_series`](../../supabase/migrations/0033_invoice_series.sql) | FY-scoped GST series via `next_doc_no` → a real `invoice_no` (not the UUID stub) | SALT-187 / 209 |
| [`0034_sale_tenders`](../../supabase/migrations/0034_sale_tenders.sql) | `p_tenders` — split payment (Cash+UPI+Card+Credit) recorded in `sale_tenders` | SALT-198 |
| [`0045_idempotency_keys`](../../supabase/migrations/0045_idempotency_keys.sql) | `p_idempotency_key` — a retried/offline-replayed save returns the same invoice instead of double-billing | SALT-202 / 205 |
| [`0050_create_sales_invoice_salesman`](../../supabase/migrations/0050_create_sales_invoice_salesman.sql) | `p_salesman_id` — attribute the sale to a salesman | SALT-192 |
| [`0057_fractional_stock`](../../supabase/migrations/0057_fractional_stock.sql) | Per-line `loose_units` — sell base units from an open pack; stock decremented in base units (`qty × units_per_pack + loose_units`) | SALT-164 |

Adjacent server pieces: [`resolve_price`](../../supabase/migrations/0039_price_rules.sql) (0039,
customer pricing rules), [`gst_rate_for`](../../supabase/migrations/0046_gst_rate_schedule.sql)
(0046, date-effective GST), [`party_credit`](../../supabase/migrations/0047_party_credit.sql)
(0047, cashier-safe credit read), `void_sales_invoice` (0028), `approval_requests` (0030),
sales-return validation (0037). See [data-model](data-model.md) and [security-rls](security-rls.md).

## Client architecture

**Stores (Zustand).**
- [`useBill`](../../apps/web/src/store/bill.ts) — all mutable bill state: `lines`, `payment`,
  `party`, `rx`, `billDiscount`, plus actions (`addItem` FEFO, `setQty`/`setBatch` with the
  per-item stock cap, `setDiscount`, `setLoose`, `setRate`, `clear`). Line key = `itemId:batchNo`.
- [`useCatalog`](../../apps/web/src/store/catalog.ts) — items + batches loaded once per org
  (paged past PostgREST's 1000-row cap), grouped by item; falls back to the demo seed when the
  org has none, and to an offline read-cache when the network is down.
- [`useHeldBills`](../../apps/web/src/store/heldBills.ts) — parked bills (set one aside, serve the
  next customer); server-synced so a hold resumes on any counter/device (SALT-180).

**Pure logic ([`lib/billing.ts`](../../apps/web/src/lib/billing.ts)) — the money source of truth.**
Line math (`lineGross`/`lineNet`/`lineCost`/`lineMargin`, loose-unit aware via `lineBaseUnits`),
the `gstSplit` (CGST/SGST vs IGST), and `apportionedLineNets` (whole-bill discount spread
pro-rata by line net with the **largest-remainder** method so shares sum exactly). The H1 gate
predicates (`requiresRx`/`gatedLines`, `GATED_SCHEDULES`) live here too. The same functions feed
the displayed totals, the printed receipt ([`billPrint.ts`](../../apps/web/src/lib/billPrint.ts)),
and the [`orders.ts`](../../apps/web/src/lib/orders.ts) payload — so all three agree.

**Other libs:** `gstSchedule.ts` (resolve a rate by document date), `credit.ts` (the non-blocking
over-limit check), `substitutes.ts` (out-of-stock same-salt alternatives), `approvals.ts`
(over-limit credit/discount gates), `billReturn.ts` (credit notes), `outbox.ts` + `offline.ts`
(the durable write queue checkout rides through an outage).

## Feature map

Most billing features have a dedicated wiki page; this is the index:

- **Checkout / Save & Print, H1/X gate, FEFO, search, substitutes, parked bills, layout & keyboard
  map** → [billing-screen](billing-screen.md).
- **Customer pricing rules** (`resolve_price`) — line rate resolves to the winning rule, else MRP;
  a manual edit sticks. Driven by `usePriceResolution.ts` (SALT-191).
- **GST** — inclusive split shown at checkout and on the receipt; rates resolved by **invoice
  date** via the rate schedule (the 22-Sep-2025 medicine cutover). See [gst-returns](gst-returns.md).
- **Salesman attribution** → [salesman](salesman.md) (SALT-192).
- **Split-tender payment** (Cash+UPI+Card+Credit in one bill) → [payments](payments.md) (SALT-198).
- **Offline-first checkout** — optimistic save, provisional invoice no, queue-on-save through the
  outbox with idempotent replay → [offline-first](offline-first.md) (SALT-202 / 205).
- **Live stock** — other counters' sales reflect on this counter's search/FEFO in real time →
  [realtime](realtime.md) (SALT-179; needs `0049_publish_batches_realtime` applied to go live).
- **Approvals inbox** — over-credit-limit and over-discount sales raise a manager-approval request
  rather than silently saving (SALT-175 / 206).
- **Loose-unit (part-strip) sale** — sell base units from an open pack, priced per unit
  (`rate ÷ units_per_pack`); a `pack`/`loose` toggle appears only when an item is divisible
  (SALT-164, this lane).
- **Returns / credit notes** → [returns](returns.md).

## Decisions & gotchas

- **Server recomputes money.** The client sends `line_total_paise` (post-discount net); the RPC
  backs the GST out of it. Never trust a client-sent tax amount. Inclusive GST + integer paise per
  [decisions/0003-money-as-paise](../decisions/0003-money-as-paise.md).
- **Safe-by-default rollout.** New RPC params are sent **only when the feature is active** (e.g.
  `loose_units` omitted for whole-pack lines, `p_tenders` omitted for single-payment bills), so the
  client keeps working against a database where the newest migration isn't applied yet. Realtime
  subscriptions stay dormant until their publication migration lands.
- **Cumulative chain.** Because `create_sales_invoice` is re-declared each migration, a new slice
  must carry forward every earlier param/behaviour — diff against the latest version, not 0018.
- **Duplicate migration numbers exist** (`0039_price_rules` + `0039_salesman`; `0049_invoice_scans`
  + `0049_publish_batches_realtime`) from parallel lanes branching off a stale base. They are
  independent objects so it is harmless, but **probe the live DB for the true max** before numbering
  a new one.
- **Dual H1 defense.** The client gate (`useCheckout`) blocks save without prescriber+patient; the
  server (0032) independently rejects and records the register row — UI convenience over a hard
  server contract.

## Current vs planned

**Shipped (32 tickets):** the full counter flow — search → FEFO add → batch switch → line/bill
discounts → loose units → H1/X gate → customer pricing → date-effective GST → split tender →
salesman → real GST-series invoice no → Save & Print → offline-queued, idempotent, oversell-safe
save → live cross-counter stock → manager-approval gates → returns/credit notes.

**Operator follow-ups (not code):** run [`0049_publish_batches_realtime`](../../supabase/migrations/0049_publish_batches_realtime.sql)
to switch live stock from dormant to on; confirm `0050` (salesman) is applied.

**Still planned** (per `salt-prd-v0.3.md`): drug-license number on the printed receipt (no entry UI
for `drug_licenses` yet); richer loyalty/scheme engine; and the loose-unit UI wants a visual pass at
a real counter (wired but not yet rendered-verified).

## Related
[billing-screen](billing-screen.md) · [data-model](data-model.md) · [payments](payments.md) ·
[salesman](salesman.md) · [offline-first](offline-first.md) · [realtime](realtime.md) ·
[gst-returns](gst-returns.md) · [returns](returns.md) ·
[decisions/0003-money-as-paise](../decisions/0003-money-as-paise.md) ·
[domain/medical-retail](../domain/medical-retail.md)
