---
type: architecture
updated: 2026-06-02
tags: [payments, receivables, accounting]
---

# Payments

Recording money **in** from customers (receipts) and **out** to vendors, on a
shared `payments` ledger with server-side double-entry. The module owns
`apps/web/src/components/payments/**` and `apps/web/src/lib/payments.ts`.

## Backend contract (live)

Defined in `supabase/migrations/0021_payments.sql` — **applied to the live DB** (the
app calls it); only the `supabase/migrations/` mirror is pending (hygiene task
HYG-1). Money is integer paise.

- **`payments`** — `id, org_id, shop_id, party_id (→ ledgers), direction
  ('received'|'paid'), payment_date, mode ('cash'|'upi'|'card'|'cheque'|'bank'|
  'adjustment'), amount_paise, reference, bank_account_id, notes, status
  ('pending'|'cleared'|'bounced'), salesman_id (0039), cheque_due_date (0028),
  created_by, created_at`. RLS: per-org `is_member`.
- **`payment_allocations`** — optional split of a payment across specific open docs
  (`target_table ∈ {sales_invoice, purchase, ledger_bill}`, `allocated_paise`).
- **`record_payment(p_shop_id, p_party_id, p_direction, p_mode, p_amount_paise,
  p_reference?, p_allocations?, p_notes?, p_salesman_id?, p_idempotency_key?) → uuid`**
  — security-definer; inserts the payment (+ allocations) then posts the double entry
  via `post_entry`: `received` ⇒ Dr CASH/BANK, Cr party; `paid` ⇒ Dr party, Cr
  CASH/BANK. `cash` routes to the CASH account, the rest to BANK; `adjustment` is
  **rejected** (journal voucher only) and excluded from the UI mode list. The
  trailing params are cumulative additions by later lanes: `p_salesman_id` (0043 —
  attributes a receipt to the collecting salesman) and `p_idempotency_key` (0045).
- **`cash_drawer`** (per-shift cash recon) and **`bank_statement_lines`** (bank-rec
  import) — both now have UI (SALT-059 / SALT-058).

**Payments never touch document `paid_paise`.** A receipt nets against a party at
the ledger level — `partyDue + paymentsAdjustment` in `lib/orders.ts`
(`due = opening + unsettled docs − net receipts`) — not by marking individual
invoices paid. So per-invoice outstanding is **derived on read** as
`total − paid_paise − Σ allocations` (see the make-payment screen below).

## As-built UI (SALT-003 / 056 / 057 / 058 / 059 / 060 / 061 / 193)

`/payments` (owner-gated; left nav → Payments) is a **tabbed hub** — `PaymentsPage`
holds the view switch; each tab is its own component under `components/payments/`.

- **Payments** (default tab) — Received / Paid / Net stat cards over all payments,
  direction + text filters, a `DataTable` (date · party · type · mode · reference ·
  signed amount); a row opens that payment's **receipt**.
- **`RecordPaymentDialog`** (the "Record payment" action) — party search, direction
  (auto from party type, overridable), mode, ₹ amount, mode-aware reference, notes,
  and — on a **received** payment — an optional **"Collected by" salesman** selector
  (SALT-193) that threads `p_salesman_id` so the receipt fills the `/salesmen`
  collections report. Calls `record_payment` with a 15s `withTimeout`.
- **`/payments/make`** → `MakePaymentPage` (SALT-056) — pay a vendor against their
  open purchase invoices: vendor picker → invoices with **derived outstanding**
  (`total − paid_paise − Σ allocations`), amount + mode + cheque/UTR reference,
  **oldest-first auto-allocation** (per-row editable), remainder on-account. Submits
  `record_payment(direction='paid', p_allocations)`.
- **`PaymentReceiptDialog`** (SALT-057) — open a payment for a printable receipt:
  shop header, party, amount + **amount-in-words** (Indian system), mode/reference,
  the invoices it was allocated to. **Print** opens a standalone print window
  (thermal/A4); **WhatsApp** shares it via `wa.me` (reuses `lib/collection`).
- **Bank reconciliation** tab (SALT-058) — import a statement **CSV** into
  `bank_statement_lines`, auto-match against recorded payments by signed amount +
  nearest date (`parseStatementCsv` / `reconcile`), flag unmatched on both sides
  (PDF import deferred).
- **Cash drawer** tab (SALT-059) — open a shift with a float; expected cash = float
  + net CASH payments since `opened_at`; close with counted cash → variance flag, on
  `cash_drawer`.
- **Cheques** tab (SALT-060) — cheque-mode payments with an editable
  `cheque_due_date` and a pending → cleared/bounced status; stat cards for amounts
  due ≤ 7/30 days + bounced.
- **Credit / debit notes** tab (SALT-061) — read view over `credit_notes` /
  `debit_notes`, each resolved to its originating invoice/purchase + party; filter by
  type, totals per side.
- `lib/payments.ts` owns the whole client contract — `PAYMENT_MODES`,
  `buildRecordPaymentArgs`, `recordPayment`, allocation (`autoAllocate` / `OpenDoc`),
  receipts (`amountInWords` / `buildReceiptMessage` / `loadPaymentAllocations`), and
  bank rec (`parseStatementCsv` / `reconcile`) — deliberately kept out of billing's
  `lib/orders.ts` so the modules stay disjoint.
- The same RPC also backs the per-party Receive/Make payment on the
  [party profile](../domain/parties.md) (PR #26) — these screens generalise it.

## Collection pay-links (SALT-053)

The shop carries a UPI payee address — **`shops.upi_vpa text`** (migration `0027`,
nullable), edited in Organisation settings and exposed on `useAuth().shop`. From it,
`lib/collection.ts` → **`upiPayUrl({ vpa, payeeName, amountPaise })`** builds a
`upi://pay?pa=<vpa>&pn=<encoded payee>&am=<rupees>&cu=INR` deep link (paise ÷ 100 to
2 dp; null when no VPA). The party-profile collection reminder appends it; the same
helper is reusable for receipt pay-links (SALT-057).

## Roadmap

**Shipped:** SALT-003 (record_payment UI), 056 (vendor make-payment + allocation),
057 (receipts print/WhatsApp), 058 (bank reconciliation — CSV), 059 (cash-drawer),
060 (post-dated cheques — migration 0028), 061 (credit/debit notes), 193 (collecting
salesman on receipts).

**Open:** SALT-062 (Razorpay payment links) is **blocked** on a backend edge
function — filed as **SALT-169** (create link + webhook auto-apply; the Razorpay
secret cannot live client-side). Smaller follow-ups: bank-statement **PDF** import
(058 shipped CSV only); atomic PDC accounting (defer the cash/bank posting until a
cheque clears, reverse on bounce); a `p_payment_date` param for back-dated receipts.

→ [domain/orders](../domain/orders.md) · [architecture/data-model](data-model.md) · [proposed-data-model](proposed-data-model.md)
