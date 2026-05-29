---
type: domain
updated: 2026-05-29
---

# Orders, bills & amount due

An **order** is a transaction with a party. One unified table, `orders`, carries both directions (see [../architecture/data-model.md](../architecture/data-model.md)):

- **sale** — goods out to a customer. The UI calls a sale a **bill**. Composed on the [billing screen](../architecture/billing-screen.md) (customer-bound) and persisted via `place_order`. Decrements batch stock.
- **purchase** — goods in from a vendor. Adds stock. *(The purchase branch of `place_order` is a follow-up PR; the schema already supports it.)*

`party_id` is nullable: **null = walk-in** (an anonymous cash sale that still persists and moves stock, but has no per-party history — PRD FR-C-002).

## Lines

Each `order_lines` row records what was transacted: `item_id` (nullable for ad-hoc), `name`, `batch_no`, `expiry`, `qty`, `rate_paise` (MRP for a sale, PTR for a purchase), `discount_type`/`discount_value`, `gst_rate`, and `line_total_paise` (the net after discount, GST-inclusive — Indian pharma convention). The order's `total_paise` is the sum of its line totals, computed server-side in `place_order` (the client total is never trusted).

## Payment & settlement

`payment_method` is `cash` or `credit`. On save:
- **cash** ⇒ `paid_paise = total_paise` (settled immediately).
- **credit** ⇒ `paid_paise = 0` and `due_date = today + credit_days` (the customer owes us).

A full payments ledger (recording later settlements) is a flagged follow-up; for now `paid_paise` carries the settled amount.

## Amount due (the running balance)

A party's **current due** is signed the same way as the ledger balance — **+ = receivable (they owe us), − = payable (we owe them)**:

```
due = ledgers.opening_balance_paise                         (imported starting point)
    + Σ over the party's orders of signed (total − paid)    (sale +, purchase −)
```

`opening_balance_paise` already nets the imported [trial-balance](trial-balance.md) `ledger_bills`, so those bills are shown as the *breakdown* of the opening balance — **never added again**. New in-app orders move the balance from there. The pure helpers live in `apps/web/src/lib/orders.ts` (`orderOutstanding`, `partyDue`).

## Where it surfaces

- **Billing screen** — pick the customer (default Walk-in, `Ctrl+K`), compose, Save (`F9`) → `place_order`.
- **Bills history** (`/bills`) — every saved sale, newest first; click to see its lines.
- **Party profile** (`/parties/:id`) — editable details, the **amount-due** summary, that party's order history, and the imported open bills. "New sale" binds the customer and jumps to billing; the saved order links back via `party_id`.

## Stock guard

`place_order` only persists a sale if every line's batch has enough stock (`qty >= sold`), raising otherwise — the whole transaction rolls back. Bills can only be saved against a **real imported catalogue**; on the demo seed catalogue the Save action is disabled (seed items aren't DB rows, so stock can't move).
