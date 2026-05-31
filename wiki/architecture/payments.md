---
type: architecture
updated: 2026-06-01
tags: [payments, receivables, accounting]
---

# Payments

Recording money **in** from customers (receipts) and **out** to vendors, on a
shared `payments` ledger with server-side double-entry. The module owns
`apps/web/src/components/payments/**` and `apps/web/src/lib/payments.ts`.

## Backend contract (live)

Defined in `supabase/proposed/0021_payments.sql` — **applied to the live DB** (the
app calls it); only the `supabase/migrations/` mirror is pending (hygiene task
HYG-1). Money is integer paise.

- **`payments`** — `id, org_id, shop_id, party_id (→ ledgers), direction
  ('received'|'paid'), payment_date, mode ('cash'|'upi'|'card'|'cheque'|'bank'|
  'adjustment'), amount_paise, reference, bank_account_id, notes, status
  ('pending'|'cleared'|'bounced'), created_by, created_at`. RLS: per-org `is_member`.
- **`payment_allocations`** — optional split of a payment across specific open docs
  (`target_table ∈ {sales_invoice, purchase, ledger_bill}`, `allocated_paise`).
- **`record_payment(p_shop_id, p_party_id, p_direction, p_mode, p_amount_paise,
  p_reference?, p_allocations?, p_notes?) → uuid`** — security-definer; inserts the
  payment (+ allocations) then posts the double entry via `post_entry`: `received`
  ⇒ Dr CASH/BANK, Cr party; `paid` ⇒ Dr party, Cr CASH/BANK. `cash` routes to the
  CASH account, the rest to BANK; `adjustment` is **rejected** (must go via a
  journal voucher) and so is excluded from the UI mode list.
- **Hooks (tables only, no UI yet):** `cash_drawer` (per-shift cash recon),
  `bank_statement_lines` (bank rec).

**Payments never touch document `paid_paise`.** A receipt nets against a party at
the ledger level — `partyDue + paymentsAdjustment` in `lib/orders.ts`
(`due = opening + unsettled docs − net receipts`) — not by marking individual
invoices paid. So per-invoice outstanding is **derived on read** as
`total − paid_paise − Σ allocations` (see the make-payment screen below).

## As-built UI (SALT-003, SALT-056)

- **`/payments`** (owner-gated route; left nav → Payments) → `PaymentsPage`:
  Received / Paid / Net stat cards over all payments, direction + text filters, a
  `DataTable` (date · party · type · mode · reference · signed amount); a row opens
  the party profile.
- **`RecordPaymentDialog`** — party search, direction (auto from party type, but
  overridable), mode buttons, ₹ amount, mode-aware reference label, notes → calls
  `record_payment` with a 15s `withTimeout`. `lib/payments.ts` owns `PAYMENT_MODES`,
  `buildRecordPaymentArgs` (adds `p_notes`), `recordPayment`, and `signedAmount` —
  deliberately kept out of billing's `lib/orders.ts` so the modules stay disjoint.
- **`/payments/make`** → `MakePaymentPage` (SALT-056) — pay a vendor against their
  open purchase invoices: vendor picker → invoices with **derived outstanding**
  (`total − paid_paise − Σ allocations`), amount + mode + cheque/UTR reference,
  **oldest-first auto-allocation** (per-row editable), any remainder recorded
  on-account. Submits `record_payment(direction='paid', p_allocations)`; the new
  `autoAllocate` / `allocatedTotal` / `OpenDoc` helpers live in `lib/payments.ts`.
- The same RPC also backs the per-party Receive/Make payment on the
  [party profile](../domain/parties.md) (PR #26) — this screen generalises it.

## Roadmap (open tickets)

Built: `record_payment` UI (**SALT-003**) + vendor make-payment with invoice
allocation (**SALT-056**). Remaining module tickets: receipts print/WhatsApp
(SALT-057), bank reconciliation (SALT-058), cash-drawer recon (SALT-059),
post-dated cheques (SALT-060), credit/debit notes linked to invoice + return
(SALT-061), Razorpay links (SALT-062). Allocation is reflected by read-derived
outstanding (no `paid_paise` write); back-dating still needs a new
`p_payment_date` RPC param.

→ [domain/orders](../domain/orders.md) · [architecture/data-model](data-model.md) · [proposed-data-model](proposed-data-model.md)
