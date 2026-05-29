---
type: domain
updated: 2026-05-29
---

# Trial balance format (Saral / Marg / Tally)

How the accounting export we ingest as "ledgers" is shaped, and how we parse it. Reference sample: `Saral/Trial_Balance.xls` (a real shop's export, **untracked / never committed**). Parser: [smartLedger.ts](../architecture/import-pipeline.md).

## Structure

A trial balance is **not tabular** — it's a printed report:

- Title block (shop name, address, financial year) for the first several rows.
- A **two-line header**: `PARTICULARS | OPENING BALANCE | DETAILS OF TRANSACTIONS | CLOSING BALANCE`, with `DEBIT` / `CREDIT` on the second line under "details of transactions".
- Then, per party: a **ledger row** (name in col 0; opening, debit, credit, closing magnitudes; a Dr/Cr nature cell), followed by **bill sub-rows** (one per open invoice) and an optional `Ph.:` line.

In the sample every row has 9 columns; the meaningful ones are: `col0 name`, `col4 opening` (inline e.g. `6396.00 Dr`), `col5 debit`, `col6 credit`, `col7 closing`, `col8 nature (Dr/Cr)`. We locate these **by detecting the header**, not hardcoding indices.

## Dr / Cr convention

- **Dr (debit) balance = receivable** — money the party owes the shop → stored **positive**.
- **Cr (credit) balance = payable** — money the shop owes the party → stored **negative**.
- `ledgers.opening_balance_paise` is this **signed** closing balance.

## The reconciliation identity

For every ledger: **`opening + debit − credit = closing`**. This is the correct quality check — *not* "do the bills sum to the closing balance" (they don't: the sub-rows are the open invoices plus a brought-forward opening, and a party can have a debtor and creditor side). A complete trial balance also nets to **₹0** across all parties (total debits = total credits) — an independent whole-file check.

> Bug history: an early parser filtered out blank cells before reading columns, so a blank debit/credit shifted the others and 49 ledgers falsely "failed" reconciliation. Reading **positionally by detected column** fixed it → 475/475 reconcile exactly.

## Bill (sub-row) format

`[*** * markers] [ref?]  bill-date  [(]amount Dr|Cr[)]  [due-date]  [days]`
e.g. `* S001112  22-04-2026  36749.00 Dr  22-04-2026  57`. Tolerant of leading markers, parenthesized contra amounts, and blank refs. Parsed into `ledger_bills(ref_no, bill_date, amount_paise, nature, due_date, days_overdue)`.

## Same-name parties

The export legitimately lists one name multiple times — e.g. MANKIND PHARMA as a receivable **and** a payable (same vendor, debtor + creditor ledgers). These are real distinct accounts, so import keeps them all; merging is a separate, user-confirmed step → [parties](parties.md).

## Related
[parties](parties.md) · [import-pipeline](../architecture/import-pipeline.md) · [decisions/0006-trial-balance-column-identity](../decisions/0006-trial-balance-column-identity.md)
