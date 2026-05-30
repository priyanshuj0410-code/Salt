---
type: domain
updated: 2026-05-31
---

# Documents, dues & the ledger

Every customer/vendor transaction is a **document** that posts to two shared ledgers — `stock_movements` (inventory) and double-entry `ledger_entries` (money). See [../architecture/proposed-data-model.md](../architecture/proposed-data-model.md) and [decision 0009](../decisions/0009-target-data-model.md).

> **Migration note.** The original unified `orders` table + `place_order` RPC has been **retired from the app** (sales → PR #23, purchases → PR #25). Historical `orders` rows were copied into `sales_invoices`/`purchases`; the table stays in the DB for history only. Documents are now **shop-scoped** (`shop_id`, from the org's primary shop resolved in the auth context).

## The documents

- **Sale (a bill)** — goods out to a customer. Composed on the [billing screen](../architecture/billing-screen.md) (customer-bound, default **Walk-in** = null party) and saved via **`create_sales_invoice`** → `sales_invoices` + `sale_lines`. The RPC owns the GST split (backs CGST/SGST/IGST out of the MRP-inclusive line total by comparing shop vs party state), decrements the batch, and posts a `sale` stock movement + the double entry (Dr cash/bank or party · Cr Sales · Cr GST output).
- **Purchase (a GRN)** — goods in from a vendor. Entered on the vendor profile (`/parties/:id/purchase`) and saved via **`receive_purchase`** → `purchases` + `purchase_lines`. Adds stock (qty + free goods), posts a `purchase` movement + Dr Purchase · Dr GST input (ITC) · Cr vendor.

## Lines

`sale_lines` / `purchase_lines` record item/batch/qty/rate plus the per-line GST split the RPC computes. Money is integer **paise**; totals are computed server-side (the client total is never trusted).

## Payments & settlement

Two layers:
- **At document time** — the invoice/GRN `payment_method` sets `paid_paise` (cash/card/upi/bank ⇒ paid in full; credit ⇒ unpaid, `due_date = today + credit_days`).
- **Later settlements** — recorded per party via **`record_payment`** (the `payments` table; posts the cash·bank ↔ party double entry). "Receive payment" (customer) / "Make payment" (vendor) on the party profile.

## Amount due (the running balance)

Signed like the ledger balance — **+ = receivable (they owe us), − = payable (we owe them)**:

```
due = ledgers.opening_balance_paise                          (imported starting point)
    + Σ over the party's documents of signed (total − paid)  (sale +, purchase −)
    − Σ net payments received                                (receipts lower a receivable,
                                                               payments lower a payable)
```

`opening_balance_paise` already nets the imported [trial-balance](trial-balance.md) `ledger_bills` (shown as the *breakdown* of the opening balance — never added again). Payments don't touch document `paid_paise`, so folding them in doesn't double-count. The pure helpers live in `apps/web/src/lib/orders.ts` (`orderOutstanding`, `partyDue`, `paymentsAdjustment`).

## Where it surfaces

- **Billing screen** — pick the customer (default Walk-in, `Ctrl+K`), compose, Save (`F9`) → `create_sales_invoice`.
- **Bills history** (`/bills`) — every saved sale (`sales_invoices`), newest first; click for its lines.
- **Party profile** (`/parties/:id`) — editable details, the **amount-due** summary, the merged sale+purchase history, recorded **payments**, and the imported open bills. "Receive/Make payment" opens the payment dialog; "New sale" binds the customer and jumps to billing.

## Stock guard

`create_sales_invoice` only persists a sale if every line's batch has enough stock (`qty >= sold`), raising and rolling back otherwise. Bills save only against a **real imported catalogue** and once a primary **shop** resolves; on the demo seed the Save action is disabled.
