---
type: architecture
updated: 2026-05-31
tags: [import, marg, data-model]
---

# Marg ERP 9+ → Salt: full import map

Everything a Marg ERP 9+ shop can export, mapped to the Salt table it hydrates. This is the **scope for extending [Smart Import](import-pipeline.md) past today's four files** — not a description of what imports now.

Two things are true at once:
- The **full data model is live** — migrations 0014–0024 applied to Supabase on 2026-05-31, 55 tables covering sales, purchases, returns, payments, double-entry accounting, GST and compliance (see [proposed-data-model](proposed-data-model.md), [schema](schema.md)).
- **Smart Import only fills four files** today — Trial Balance, Party GST Master, Item/HSN Master, Stock Report — i.e. *masters + opening balances only* ([import-pipeline](import-pipeline.md), [decision 0008](../decisions/0008-import-join-keys.md)).

This page closes that gap: it lists every Marg export worth ingesting and the table(s) it lands in, so the importer can grow from four files to the whole model.

> **Caveat.** Exact Marg report names and column headers vary by edition (Marg Pharma / Excellent / ERP 9+) and version. The importer is **format-generic** (the same machinery already absorbs Saral/Marg/Tally) and column names need not match — `autoMap` in `smartImport.ts` matches headers to fields (exact > substring > fuzzy) and every step has a manual mapping fallback. So the **column→field mapping and the join keys** below matter far more than the precise header text. The one real sample on hand is a Saral export; this page is written for a Marg shop (the target persona), but the design generalizes.

Status legend: **✅** imports today · **🔜** needs importer build · **⚠** needs a model or decision change first.

## 1. How Marg organizes its data

Marg is a FoxPro/DBF-backed, menu-driven ERP that exports any report to Excel/CSV. Its data splits into:
- **Masters** — accounts/ledgers (parties), items/products, salesmen, doctors, companies, salts, groups, banks.
- **Opening balances** — trial balance (party balances), bill-wise outstanding, batch-wise closing stock.
- **Registers / vouchers** — sales, purchases, returns, receipts/payments, journals, stock transfers/adjustments.
- **Compliance** — Schedule H/H1 register, drug licences, GST returns.

Two spines hold everything together: a per-shop alphanumeric **item code** is the product key, and **GSTIN (or normalized name)** is the party key. Every transaction line refers back to these.

## 2. Export inventory → Salt tables

### A. Org / shop setup

| Marg export | → Salt table | Key fields | Join key | Status |
|---|---|---|---|---|
| Company / branch list | `shops` | name, code, gstin, state_code, address, phone | — | 🔜 |

Multi-shop: export **one full set per Marg company/branch** and tag every row with its `shop_id`. `orgs` / `profiles` / `memberships` / settings are created inside Salt, not imported.

### B. Masters

| Marg export | → Salt table | Key fields (typed) | Join key | Status |
|---|---|---|---|---|
| Account / Ledger master (+GST) | `ledgers` | name, type←group, phone, gstin, state_code, address, credit_limit_paise | gstin → name | ✅ partial · 🔜 richer |
| Item / Product master | `items` | **item_code**, name, salt, manufacturer, pack, hsn, gst_rate, schedule, barcode, reorder_level, unit, pack_size, therapeutic_category, ayush_flag, default_discount | item_code | ✅ core · 🔜 extras |
| Salesman master | `salesmen` | name, phone, territory | — | 🔜 |
| Doctor master | — (no table) | doctor name/reg-no | — | ⚠ |
| Patient master (rare) | `patients` | name, phone, address | — | 🔜 |
| Account/ledger groups | `chart_accounts` | code, name, type, parent | group name | 🔜 |
| Bank master | `chart_accounts` (BANK) | account name | — | 🔜 |

- **Ledger master** is the richest party source. Beyond the typed columns, keep PAN, email, drug-licence no, credit days, area/route, salesman, price-list verbatim in `ledgers.source` (jsonb) — promotable later (credit_days → invoice defaults, salesman → `salesmen`).
- **Item master** `item_code` is **the product join key** — it must be identical here, in the stock report, and on every transaction line. Rack, min/max, marketing company → `items.source`.
- **Doctor master** has no home table yet → fold into `h1_register.doctor_name` / `source`, or add a `doctors` table (see §4).

### C. Opening balances & stock (cutover snapshot)

| Marg export | → Salt table | Key fields | Join key | Status |
|---|---|---|---|---|
| Trial Balance | `ledgers.opening_balance_paise` (+ opening `ledger_entries`) | name, opening (Dr/Cr) | name | ✅ |
| Bill-wise Outstanding (Debtors + Creditors) | `ledger_bills` | ref_no, bill_date, amount_paise, nature, due_date, days_overdue | party name | ✅ |
| Batch-wise closing stock | `batches` (+ `stock_movements` reason=`opening`) | item_code, batch_no, expiry, qty, mrp_paise, ptr_paise | item_code → name | ✅ batches · 🔜 movement |

- Opening balance is **signed**: Dr = + (receivable), Cr = − (payable). It seeds both the ledger balance and a balanced opening entry in `ledger_entries`.
- Open bills come from the trial-balance sub-rows today (`parseBill` already captures date/amount/Dr-Cr/due-date); a dedicated **Outstanding** report gives cleaner dated detail if available.
- Stock imports as **one batch per row** (negative on-hand is real and kept). The extension should also post an `opening` `stock_movements` row so the inventory ledger reconciles.

### D. Transaction history — the main extension

| Marg export | → Salt table(s) | Key fields | Status |
|---|---|---|---|
| Sales register (+ item/batch detail) | `sales_invoices` + `sale_lines` | invoice_no, date, party, salesman, payment_method, taxable/CGST/SGST/IGST/discount/round_off/total/paid; lines: item_code, batch, expiry, qty, rate(MRP), discount, gst splits, line_total, doctor_name | 🔜 |
| Sales returns | `credit_notes` + `credit_note_lines` | note_no, date, party, ref invoice, qty, taxable, gst splits | 🔜 |
| Purchase register / GRN (+ detail) | `purchases` + `purchase_lines` | grn_no, vendor_invoice_no/date, received_date, vendor, taxable/splits/total/paid; lines: item_code, batch, expiry, qty, **free_qty**, ptr, mrp, discount, scheme_text, gst splits | 🔜 |
| Purchase returns | `debit_notes` + `debit_note_lines` | note_no, date, vendor, qty, taxable, gst splits, itc_reversal | 🔜 |
| Receipt / Payment vouchers (cash & bank book) | `payments` (+ `payment_allocations`) | direction, mode, amount, reference, party, date; allocations: target bill | 🔜 |
| Stock transfers (branch ↔ branch) | `stock_transfers` + `stock_transfer_lines` | from/to shop, item, batch, qty | 🔜 |
| Stock adjustments / breakage / expiry write-off | `physical_counts(+lines)` / `stock_movements` (`adjustment`/`writeoff`) | item, batch, qty delta, reason | 🔜 |

The **purchase/GRN register is the authentic source of batch granularity** (true batch + expiry + cost per receipt) — richer than the opening-stock snapshot. Sales H/H1 lines should also fan out into `h1_register`.

### E. Accounting (optional, high effort)

| Marg export | → Salt table(s) | Notes | Status |
|---|---|---|---|
| Journal & contra vouchers / Day book | `journal_vouchers` + `ledger_entries` | Needs Marg group → `chart_accounts` mapping; full double-entry replay | 🔜 ⚠ |

Recommendation: import **opening balances only** for now (already covered in §C); defer replaying the full general ledger — it's high-effort and largely re-derivable once sales/purchases/payments import.

### F. Compliance

| Marg export | → Salt table | Status |
|---|---|---|
| Schedule H / H1 register | `h1_register` (drug, schedule, batch, qty, doctor, patient, date) | 🔜 |
| Drug licence details | `drug_licenses` (type, no, holder, issue/expiry) | 🔜 |
| GSTR-1 / 3B filed summaries | `gst_returns` (period, type, status, summary jsonb) — historical record; mostly derivable | 🔜 |
| GSTR-2B (from the GST portal, **not** Marg) | `gstr2b_imports` + `gstr2b_lines` | 🔜 |
| Voucher series / last bill numbers | `invoice_series` (doc_type, prefix, next_number, financial_year) — numbering continuity | 🔜 |

### Not sourced from Marg

`orgs` / `profiles` / `memberships` (auth) · `master_items` (global drug seed) · `item_aliases` / `item_substitutes` (derived) · `print_templates` / `org_settings` / `shop_settings` (configured) · `cash_drawer` / `bank_statement_lines` (operational) · `gstr2b_matches` (computed) · Tier-4 hooks `purchase_ocr_jobs` / `ondc_listings` / `b2b_connections`.

## 3. Cross-cutting rules for the importer extension

- **Join / identity keys.** Party = **GSTIN (canonical) → normalized name (fallback)** — extends [0008](../decisions/0008-import-join-keys.md), which was name-only, now that the account master carries GSTIN. Item = **`item_code`** across master, stock and every transaction line. Document lines → header by Marg doc no; header → party/item by the keys above.
- **Money.** Rupees → ×100 paise (`toPaise`). Sales are **MRP-inclusive** (back the tax out); purchase PTR is **tax-exclusive**.
- **Tax.** Map CGST/SGST/IGST per line; derive `is_interstate` from party state vs shop state.
- **Dates & signs.** `dd-mm-yyyy` / `dd/mm/yyyy`; expiry `MM/YY` → `YYYY-MM` (`toExpiryYM`). Trial-balance Dr = +, Cr = −.
- **Faithful capture.** Every unmapped column → the row's `source` jsonb (the existing pattern, [decision 0008](../decisions/0008-import-join-keys.md)); extend it to the new document tables so nothing is dropped.
- **Idempotency / dedup.** Masters upsert (`items` on `org_id,item_code`; `ledgers` on `org_id, gstin|name`). **Documents need a natural import key** — e.g. `(org_id, shop_id, doc_type, source_doc_no)` — to make re-import safe (⚠ small migration).
- **Cascade order.** shops → groups/`chart_accounts` → salesmen/doctors → ledgers (+GST) → items → opening stock → purchases → sales → returns → payments → (journals).
- **Stock consistency.** ⚠ Decide: import an opening **snapshot** *or* replay the full movement history — **never both** (double counting). Recommended: snapshot at a cutover date + only post-cutover movements.
- **Multi-shop & volume.** One export set per branch. Registers are large → chunked inserts (`CHUNK = 500`) and range pagination (`selectAll`) already exist.

## 4. Decisions this forces

Decided (2026-05-31):
1. ✅ **GSTIN as canonical party identity** (→ normalized name fallback), refining name-only [0008](../decisions/0008-import-join-keys.md) → [0010](../decisions/0010-gstin-canonical-party-identity.md).
2. ✅ **Document import idempotency key** (`source_system` + `source_doc_no`, partial-unique per doc table) → [0011](../decisions/0011-document-import-idempotency-key.md).
3. ✅ **Stock cutover = snapshot, not replay** (snapshot authoritative at a cutover date; pre-cutover docs don't post effects) → [0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md).

4. ✅ **GL history depth = opening balances only** — no full general-ledger replay; pre-cutover docs stay records-only; optional read-only period-summary archive → [0013](../decisions/0013-gl-history-depth.md).
5. ✅ **Doctors master** — add a `doctors` table, nullable `doctor_id` FK from `h1_register`, identity reg-no → name → [0014](../decisions/0014-doctors-master.md).

## Related

[import-pipeline](import-pipeline.md) · [proposed-data-model](proposed-data-model.md) · [schema](schema.md) · [data-model](data-model.md) · [decision 0008 — import join keys](../decisions/0008-import-join-keys.md) · [domain/trial-balance](../domain/trial-balance.md) · [domain/medical-retail](../domain/medical-retail.md)
