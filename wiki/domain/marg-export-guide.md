---
type: domain
updated: 2026-05-31
tags: [marg, import, export, operations]
---

# Marg ERP 9+ export guide (for Smart Import)

Operator-facing: how to get each file **out of Marg** to feed [Smart Import](../architecture/smart-import-extension.md). For the engineering design see that page; for the export → table mapping see [marg-import-map](../architecture/marg-import-map.md).

> **Caveat — read first.** Exact menu names and column headers **vary by Marg edition** (Pharma / Excellent / ERP 9+) **and version**. Treat the paths below as *representative* — verify in your install. It doesn't need to be exact: Smart Import **auto-maps** columns (it scores headers against known aliases) and has a manual mapping step, so getting the **right columns and the join keys** matters far more than precise header text. Mappings get tuned once we see a real sample of your files.

## How Marg exports (general mechanics)

- Most **report** screens can export to Excel — commonly an **Export** button, a function key, or **print preview → Export/Save as Excel**. PDF is *not* useful here; export **Excel (.xlsx)** or **CSV**.
- **Masters** (items, accounts) often also export via **Tools/Utilities → Export** (to Excel).
- Set the **date range to the full history** (or "since inception") for registers; set it to your **cutover date** for the opening snapshots.

## Export order

Export and import in this order — the importer needs masters before the documents that reference them:

**Masters → Opening balances → Transaction history → Compliance.**

## Golden rules (every file)

- **`item_code` must be identical** across the item master, the stock report, and every transaction line — it's the product join key.
- **Amounts in rupees**, not paise (₹ symbols and commas are fine — they're stripped).
- Keep **Dr/Cr** indicators on the trial balance (the sign matters).
- Use **distinct column names** for **MRP** vs **Purchase rate / PTR / Cost** (a column literally named "Rate" maps to MRP).
- **One full export set per branch** if you run multiple Marg companies/shops.
- Export the **full party list** (the account master has more parties than the trial balance).

---

## A. Masters

### A1. Account / Ledger master (+GST) → `ledgers`
- **Marg:** Master → Account/Ledger (or Tools/Utilities → Export → Account master). **Export:** Excel.
- **Ensure columns:** Name, GSTIN, State + State code, Phone/Mobile, Address/City, Group (Sundry Debtor/Creditor…), Credit limit, Credit days, Drug Licence no, PAN, Email, Salesman, Area/Route.
- **Join:** GSTIN → name. **Watch:** export *all* parties; placeholder GSTINs (`URP`, `NA`, blanks) are treated as none → matched by name.

### A2. Item / Product master → `items`
- **Marg:** Master → Item/Product (or Reports → Stock → Item/Price list). **Export:** Excel.
- **Ensure columns:** **Item Code**, Name, Company (manufacturer), Salt/Composition, Pack, Unit, HSN, **GST% (combined)**, Schedule (OTC/H/H1/X), Barcode, Rack, Min/Max/Reorder, MRP.
- **Join:** `item_code`. **Watch:** the *same* item code must appear in the stock report and all transaction files; export a single combined GST% column (not separate CGST/SGST).

### A3. Salesman master → `salesmen`
- **Marg:** Master → Salesman. **Ensure:** Name, Phone, Area/Territory.

### A4. Doctor master → `doctors`
- **Marg:** Master → Doctor (pharma editions). **Ensure:** Name, Registration no, Specialty, Phone. **Join:** reg-no → name. Needed for Schedule H/H1 prescriber records.

### A5. Account groups → `chart_accounts`
- **Marg:** Master → Group (or Reports → Group summary). **Ensure:** Group name, Nature (Asset/Liability/Income/Expense). Only needed if you want Marg's account structure mapped; Salt seeds a standard chart otherwise.

### A6. Branch / Company list → `shops`
- **Marg:** company/branch profile. **Ensure:** Name, Code, GSTIN, State code, Address, Phone. One row per branch; export a separate data set per branch.

## B. Opening balances (as of your cutover date)

### B1. Trial Balance → opening balances (`ledgers`)
- **Marg:** Reports → Accounts/Final reports → **Trial Balance** (with bill detail if offered). **Export:** Excel.
- **Ensure columns:** Party/Particulars, Opening, Debit, Credit, Closing, **with Dr/Cr**. **Watch:** keep the Dr/Cr indicator; the report should reconcile opening + debit − credit = closing.

### B2. Bill-wise Outstanding → open bills (`ledger_bills`)
- **Marg:** **Outstanding** → Receivable + Payable → **bill-wise** detail. **Export:** Excel.
- **Ensure columns:** Party, Bill no/ref, Bill date, Amount, Dr/Cr, Due date, Days. (If your trial balance already lists bills under each party, that file suffices.)

### B3. Batch-wise closing stock → on-hand (`batches`)
- **Marg:** Reports → Stock → **Batch-wise / Closing stock with expiry**. **Export:** Excel.
- **Ensure columns:** **Item Code**, Item name, Batch no, Expiry, Closing Qty, MRP, **Purchase rate/PTR/Cost**. **Watch:** negative quantities are real — export as-is; distinct MRP vs PTR columns.

## C. Transaction history (full date range)

> Imported as **records only** — they don't move stock or post accounting (your opening snapshot already reflects them). They give you registers, GST history, batch/cost provenance, and party statements.

### C1. Purchase / GRN register → `purchases` + lines  *(build first)*
- **Marg:** Reports → Purchase → **Purchase register** (item/batch detail). **Export:** Excel.
- **Ensure columns (header):** GRN/Purchase no, Vendor (name/GSTIN), Vendor invoice no + date, Date, Taxable, CGST/SGST/IGST, Total, Paid. **(lines):** Item Code, Batch, Expiry, Qty, **Free qty**, PTR, MRP, Discount, Scheme, GST%. **Join:** doc-no (lines→header), vendor (GSTIN/name), item_code.

### C2. Sales register → `sales_invoices` + lines
- **Marg:** Reports → Sale → **Sale register** (item/batch detail). **Ensure (header):** Invoice no, Date, Party (name/GSTIN), Salesman, Payment mode, Taxable, CGST/SGST/IGST, Discount, Round off, Total, Paid, Doctor. **(lines):** Item Code, Batch, Expiry, Qty, Rate (MRP), Discount, GST%, line total.

### C3. Sales returns → `credit_notes` + lines
- **Marg:** Reports → Sale Return register. **Ensure:** Note no, Date, Party, ref invoice, item/batch/qty, taxable, GST split.

### C4. Purchase returns → `debit_notes` + lines
- **Marg:** Reports → Purchase Return register. **Ensure:** Note no, Date, Vendor, item/batch/qty, taxable, GST split.

### C5. Receipts & Payments → `payments`
- **Marg:** Reports → Accounts → Cash Book / Bank Book (or Day Book filtered to receipts/payments). **Ensure:** Voucher no, Date, Party, Direction (received/paid), Mode (cash/UPI/cheque/bank), Amount, Reference; bill-settlement detail if available → allocations.

### C6. Stock transfers / adjustments → `stock_transfers` / `stock_movements`
- **Marg:** Reports → Stock → Transfer / Adjustment registers. **Ensure:** Doc no, Date, from/to (transfer), Item, Batch, Qty, Reason.

## D. Compliance

### D1. Schedule H / H1 register → `h1_register`
- **Marg:** GST/Statutory → **Schedule H1 register**. **Ensure:** Drug, Schedule, Batch, Qty, Doctor (+ reg no), Patient, Date. (Can also be derived from the sales register's H/H1 lines.)

### D2. Drug licences → `drug_licenses`
- **Marg:** shop/company profile or party DL fields. **Ensure:** Licence type (20/21/20B/21B…), Number, Holder, Issue date, Expiry date.

### D3. GSTR-1 / 3B summaries → `gst_returns` (archive)
- **Marg:** GST → GSTR-1 / GSTR-3B → export. Filed-period summaries kept as a historical record (mostly re-derivable from the sales/purchase registers). *(GSTR-2B comes from the GST portal, not Marg.)*

### D4. Invoice series / last numbers → `invoice_series`
- **Marg:** Setup/Control → Voucher series. **Ensure:** Doc type, Prefix, Last/Next number, Financial year — so Salt continues numbering without clashing.

---

## Final checklist

- [ ] One export set **per branch**.
- [ ] Masters exported **before** history.
- [ ] `item_code` consistent across item master, stock, and all transaction lines.
- [ ] Amounts in **rupees**; Dr/Cr kept on the trial balance; MRP vs PTR columns distinct.
- [ ] Full party list (account master), not just those with balances.
- [ ] Registers cover the **full date range**; snapshots taken at the **cutover date**.
- [ ] Files saved as **.xlsx** (or CSV).

## Related

[smart-import-extension](../architecture/smart-import-extension.md) · [marg-import-map](../architecture/marg-import-map.md) · [import-pipeline](../architecture/import-pipeline.md) · [trial-balance](trial-balance.md) · [medical-retail](medical-retail.md)
