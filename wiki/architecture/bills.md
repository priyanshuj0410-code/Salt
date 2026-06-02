---
type: architecture
updated: 2026-06-02
tags: [bills, sales, credit-note, return, reprint, gst]
---

# Bills (sales history & post-sale actions)

The **post-sale** surface: every saved sale and everything you do to a bill *after* the
counter. The [billing screen](billing-screen.md) composes and saves a sale via
`create_sales_invoice`; **Bills** (`/bills`) is where those invoices are listed, opened,
reprinted, shared, returned, voided, and discussed. The outbound counterpart to
[GRN/purchase](grn.md); the credit notes it creates feed the [GSTR-1/3B](gst-returns.md)
outward return (pickup is the gst-lane follow-on **SALT-196**).

Screens under `components/bills/`; pure logic in `lib/billPrint.ts`, `lib/billFilters.ts`,
`lib/billShare.ts`, `lib/billReturn.ts`. Mostly **frontend-only** on an already-live
backbone — the one migration is `0028_void_sales_invoice.sql`.

## Read/write contract (as-built)

> ⚠️ **Stale-wiki flag.** The live sales tables — **`sales_invoices` / `sale_lines`** + the
> **`create_sales_invoice`** RPC — are the [proposed model](proposed-data-model.md)
> (`supabase/migrations/0018_sales.sql`), **applied** despite the "DO NOT RUN" label.
> [data-model.md](data-model.md) still describes sales as `orders`/`order_lines` +
> `place_order`; that is the retired model. Same situation [GRN](grn.md) flags for purchases.

- **`sales_invoices`** (bill header) — `org_id, shop_id, party_id? (FK ledgers; null = walk-in),
  invoice_no, invoice_date, status ('draft'|'placed'|'cancelled'), payment_method, credit_days,
  due_date, is_interstate, posts_effects (false = imported opening bill, no stock/ledger postings),
  subtotal/discount/taxable/cgst/sgst/igst/round_off/total/paid` (all `*_paise`). `0028` adds
  `cancelled_at / cancelled_by / cancel_reason`.
- **`sale_lines`** — `invoice_id, item_id?, batch_id?, name, batch_no, expiry, qty,
  rate_paise (MRP, tax-inclusive), discount_type/value, taxable_paise (net AFTER line + apportioned
  bill discount), gst_rate, cgst/sgst/igst_paise, line_total_paise (tax-inclusive, post-discount)`.
- **`credit_notes` / `credit_note_lines`** (sales return) — `0020_returns.sql`;
  `credit_note_lines.sale_line_id` + the returnable-qty guard added in `0037_sales_return_validation.sql`.
- Party identity is via **`ledgers`** (not a `parties` table); embed as `ledgers(name)`. Money is
  integer **paise** throughout; totals are read from the persisted columns, **never recomputed** in
  the UI. See [domain/orders](../domain/orders.md) for the documents/dues model.

## Screens & flows (8 shipped: SALT-028–033, 160, 189)

All live in `components/bills/BillHistoryPage.tsx` (the list + the per-bill dialog) unless noted.

- **History list + drill-down** (baseline). `/bills` lists `sales_invoices` newest-first (≤500),
  row → a dialog showing the lines and totals. Imported opening bills carry an `imported` badge.
- **Filters + search — SALT-030.** `lib/billFilters.ts` (pure, AND-composed): free text over
  invoice no + customer, date presets (today/yesterday/this week (Mon-start)/this month), customer,
  payment mode. The toolbar is **URL-synced** via `useSearchParams` (a filtered view is shareable
  and survives reload); header count+sum and the empty-state track the active filter; `/` focuses
  search, `Esc` clears.
- **Reprint / PDF — SALT-028.** `lib/billPrint.ts` rebuilds the counter's thermal invoice from the
  *persisted* sale (not live store state), reusing `invoiceHtml`/`printInvoice` from the
  [print module](../architecture/billing-screen.md) (`lib/print/*`). Stored paise verbatim, original
  timestamp, interstate inferred from non-zero IGST, a **DUPLICATE / REPRINT** ribbon. "PDF" = the
  print dialog's Save-as-PDF (no PDF dependency).
- **Share — SALT-029.** `lib/billShare.ts` builds a channel-neutral bill summary + `sms:`/`mailto:`
  deep links; WhatsApp reuses `lib/collection` (`whatsappUrl` + `normalizePhoneForWa`). Customer
  phone auto-filled; WhatsApp disabled with a hint when absent. (`ledgers` has **no email** column,
  so Email opens a blank-recipient compose window.)
- **Record-receipt link — SALT-033.** For an unpaid party bill, a **Record receipt** action
  deep-links to `/parties/:id?receive=1` (the existing receive-payment dialog). Hidden for walk-in /
  paid / cancelled bills.
- **Internal notes — SALT-160.** Embeds the realtime [message thread](realtime.md)
  (`<MessageThread entityType="sales_invoice" entityId={bill.id} />`, substrate from SALT-105) in the
  bill dialog — live across counters. No schema work (`entity_messages`, migration `0029`).
- **Void / cancel — SALT-031.** Migration **`0028_void_sales_invoice.sql`**: a security-definer
  `void_sales_invoice(p_invoice_id, p_reason)` that restocks (`sale_return` movements), posts the
  exact reversing double entry (Dr Sales + Dr CGST/SGST/IGST out = Cr cash/bank/party, netting the
  sale to zero), and stamps `status='cancelled'` with who/when/why. Imported opening bills
  (`posts_effects=false`) are marked only. UI: an inline reason-required confirm; cancelled bills show
  a danger dot + Cancelled badge.
- **Credit-notes ledger — SALT-032.** `CreditNotesPage.tsx` at `/bills/credit-notes` (linked from the
  Bills header): a **read-only** list of `credit_notes` with a line-detail dialog. Posting stays owned
  by the `create_credit_note` RPC.
- **Sales return (engine-backed) — SALT-189.** `ReturnDialog.tsx` + `lib/billReturn.ts`: a
  **Return items** action on the bill dialog. Builds a `ReturnBasis` per line from the persisted
  `sale_lines.taxable_paise` (the post-discount net), runs the shared **[returns engine](returns.md)**
  (`lib/returns.ts`, SALT-099) to reverse the discounted net + outward GST (never the gross), caps each
  line at the returnable balance, and calls `create_credit_note` with `sale_line_id` linkage so the
  server-side over-return guard (`0037`) agrees. Refund modes: cash / bank / credit-to-party-account.

## Key files

| File | Role |
|---|---|
| `components/bills/BillHistoryPage.tsx` | The `/bills` list + per-bill dialog; hub for every action |
| `components/bills/CreditNotesPage.tsx` | `/bills/credit-notes` read-only sales-return ledger |
| `components/bills/ReturnDialog.tsx` | Sales-return entry (qty + refund mode → `create_credit_note`) |
| `lib/billPrint.ts` | Rebuild the thermal invoice from a persisted bill (reprint) |
| `lib/billFilters.ts` | Pure history filtering (smoke-tested) |
| `lib/billShare.ts` | Bill summary text + sms/mailto deep links |
| `lib/billReturn.ts` | Map sale lines → returns-engine basis + RPC payload (smoke 14/14) |

## Decisions & gotchas

- **`sale_lines` has no `pack` / `mrp_paise`** — `rate_paise` *is* the tax-inclusive MRP. Selecting the
  phantom columns 400s (TS won't catch a Supabase column-name string).
- **`Payment.method` is `cash | credit` only** (no card/upi/bank in the client type); reprint maps
  card/upi/bank → a cash sale.
- **Shop comes from `useAuth().shop`** (has `id` for the per-shop print template); there is no
  `@/lib/tenant`. **No `ui/select`** — filters use a native `<select>`.
- **Returns reverse the discounted net, not the gross** — the engine basis is the line's persisted
  `taxable_paise`; the RPC and the UI both cap at sold − already-returned (across *placed* notes) so
  they agree.
- **GSTR-1/3B pickup of credit notes is NOT done here** — it's the gst-lane follow-on **SALT-196**
  (CDNR + 3B-net). This page only creates the notes.

## Current state vs planned

Shipped: history + drill-down, filters/search, reprint/PDF, share, record-receipt, internal notes,
void, credit-notes ledger, engine-backed sales return. **Not yet:** GSTR-1 CDNR / 3B-net (SALT-196,
gst lane); e-invoice/IRN for credit notes; bulk export of bill history. See
[product/roadmap](../product/roadmap.md) and [returns](returns.md) for the wider returns picture.
