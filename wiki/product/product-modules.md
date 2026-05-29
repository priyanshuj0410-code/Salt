---
type: product
updated: 2026-05-29
tags: [product, modules, roadmap, architecture]
---

# Product modules

The complete surface map for Salt, derived from the [PRD](prd.md), [market research](market-research.md), and the [wholesale owner persona](../domain/persona-wholesale-owner.md). Each module is a coherent user-facing surface with its own screens, data, and jobs-to-be-done.

Modules are grouped into three tiers: **Core** (must exist for Salt to be usable at all), **Complete** (must exist for Salt to replace Marg), and **Differentiate** (makes Salt strictly better than anything on the market).

---

## Dependency order

Before building any module, its dependencies must exist:

```
Catalogue ──────────────────────────────┐
                                        ▼
GRN / Purchase ──── Inventory ◄──── Counter / Billing
        │                │                  │
        ▼                ▼                  ▼
   Vendor Ledger    Expiry Mgmt       Customer Ledger
        │                │                  │
        └────────────────┴──────────────────┤
                                            ▼
                                    Payments & Accounts
                                            │
                                            ▼
                                    Returns (S + P)
                                            │
                                            ▼
                                     GST & Compliance
                                            │
                                            ▼
                                     Reports & Analytics
```

Catalogue and GRN/Purchase are the unbuilt blockers. Everything downstream of billing (payments, GST, reports) cannot be complete until billing persists sales and GRN creates stock.

---

## Tier 1 — Core (usable at all)

### 1. Catalogue / Drug Master

**What:** The item master — the full list of medicines and products the shop stocks, with all attributes needed for billing, compliance, and GST.

**Fields per item:** name, salt/molecule, manufacturer, pack size (10s/30ml/etc.), HSN code, GST rate (0/5/12/18%), schedule (H/H1/X/OTC), barcode. Per batch: batch number, expiry date, quantity, MRP-at-receipt, PTR-at-receipt.

**Why it matters:** Every other module reads from here. A wrong GST rate on an item corrupts every invoice. A missing schedule flag means H1 compliance cannot be enforced. A drug without a pre-filled HSN code forces manual entry on every invoice.

**Gap today:** Salt has the items/batches schema and importers (CSV + Smart Importer). What's missing: a pre-seeded drug database (~50k+ entries from CDSCO/NLEM/open sources), a UI for browsing and editing the catalogue, and duplicate/synonym management. The PRD calls for crowd-sourced MRP/PTR via GRN data — that moat is built over time.

**Pharma-specific:** Each item needs a `schedule` field (H/H1/X/OTC) and an `ayush` flag (ayurvedic items have different compliance and often 12% GST). Substitution — same salt, different brand — must be findable at billing time.

---

### 2. Counter / Billing (POS)

**What:** The speed-critical surface. A retail chemist or wholesale dealer's order is turned into a GST-compliant invoice in under 5 minutes, from any counter, online or offline.

**Already built (partial):** Keyboard-first billing, FEFO batch selection, useBill store, billTotals with MRP-inclusive GST back-calculation, demo catalog.

**What is missing:**
- **Sales persistence** — bills are lost on refresh; no `sales` or `bill_lines` tables exist yet
- **Credit check at billing** — before completing a sale, check the customer's outstanding against their credit limit; warn or block
- **Schedule H1 hard gate** — if the item is H1, block invoice completion until doctor name, patient name, address, batch number are recorded. Not a soft warning — a hard form
- **Schedule X block** — flag X drugs; cannot complete sale without pharmacist confirmation and org-level X license flag
- **Print** — thermal (58mm/80mm), A4, dot-matrix (for challans); the physical invoice is a D&C Rules requirement
- **Multi-counter real-time sync** — stock decremented by Counter 2 must reflect on Counter 1 immediately; currently impossible because there's no sales persistence
- **Offline-first** — bills must complete during internet outages; sync on reconnect
- **Invoice numbering** — sequential, financial-year-scoped (INV/2026-27/0042 already shown in UI)
- **Party selection at billing** — for wholesale (B2B), the buyer's GSTIN must be on the invoice; for retail counter (B2C walk-in), anonymous is fine

**Pharma-specific:** MRP-inclusive billing at the counter (the customer pays MRP printed on the strip, not MRP + GST). PTR/PTS is the purchase side — the billing screen operates on MRP only.

---

### 3. Purchase / GRN

**What:** Goods Receipt Note — the inbound side of inventory. When stock arrives from a distributor, it is entered here: the distributor's invoice number, date, and for each line: item, batch number, expiry, quantity, MRP, PTR (GST-exclusive), GST rate.

**Why it's foundational:** GRN is the source of two critical downstream flows:
1. **Stock**: increments batch quantities (the inventory balance)
2. **Accounts payable**: creates a liability to the vendor ledger (what Santosh owes the distributor)
3. **ITC**: records the input tax credit claimed on purchase (GST paid to distributor)

**Key fields per GRN line:** item, batch_no, expiry_date, qty_received, qty_free (scheme), mrp_paise, ptr_paise, discount_pct (trade discount), gst_rate, total_taxable_paise, total_gst_paise. The free-goods qty (scheme) does not carry ITC.

**Scheme capture:** Distributors give schemes — "10 strips + 1 free", "flat 10% CD on invoice", "2% scheme on 30-day payment". The scheme free goods must be captured separately (they have zero purchase value for ITC purposes but real MRP value). This is where most ERPs fall short.

**Purchase order → GRN flow:** Optional but valuable — raise a PO to the distributor, then receive GRN against it. Discrepancy between PO and GRN (short supply, price mismatch, wrong batch) is flagged for follow-up.

**Gap today:** No GRN screen or `purchases` / `purchase_lines` tables exist. This is the single biggest blocker — without GRN, there is no source-of-truth for stock (only import-time opening stock exists), no payables, and no ITC tracking.

---

### 4. Inventory Management

**What:** Real-time view of what's in stock, what's about to expire, what's moving slowly, and what needs to be returned to the distributor.

**Core views:**
- **Stock ledger** — current qty per item × batch, with expiry, MRP, cost
- **Near-expiry** — batches expiring within 30/60/90 days (configurable); surfaced proactively, not buried in a report
- **Dead stock** — items with zero sales in the last 90/180 days
- **Low stock / reorder point** — items below a configured reorder threshold

**Expiry return workflow:**
1. Mark batch as "near-expiry return pending"
2. System generates debit note to vendor
3. Vendor issues credit note — match and clear
4. Batch qty zeroed; ITC reversal amount pre-calculated (GST on the returned goods)
5. If goods are destroyed rather than returned: ITC reversal is mandatory (Section 17(5)(h) CGST)

**Physical count / audit:** Ability to enter a physical count and reconcile against system stock. Discrepancies flagged for investigation.

**Pharma-specific:** Cold-chain items (insulin, vaccines) need a `cold_chain` flag — future IoT temperature log integration hooks here. FEFO (First Expiry First Out) is enforced at billing; the inventory view should show which batches are being consumed in which order.

---

### 5. Parties — Customers

**What:** The complete picture of every retail chemist (or hospital/dispensary) who buys from the shop. Already partially built via `ledgers` + `ledger_bills` + the Parties screen.

**What's missing:**
- **Credit limit** — a hard cap per customer (e.g., Ramesh Medical: ₹50,000). Billing checks against current outstanding. If exceeded: warn (or block, owner-configurable)
- **Outstanding summary** — total receivable, oldest unpaid invoice, days outstanding
- **Receivables aging buckets** — 0–30, 31–60, 61–90, 90+ days outstanding; shown per customer and in aggregate
- **Payment receipt recording** — when a chemist pays (cash, cheque, UPI), match against open invoices; clear the outstanding
- **Collection workflow** — WhatsApp payment reminder in one click ("Santosh to Ramesh: your balance of ₹38,500 is due since 22-Apr-2026. Please pay by Friday. [pay link]")
- **Customer-specific pricing** — different customer tiers may get different prices (chain pharmacy vs. independent; high-volume vs. low-volume)

**Why it's the emotional core for Santosh:** He has ₹20–80L in receivables at any given time. This module is where he decides whether to give credit on a new order. A wrong balance here costs him real money.

---

### 6. Parties — Vendors

**What:** The complete picture of every distributor, C&F agent, or company from whom the shop buys.

**Different from customers because:**
- Santosh owes them money (payable, not receivable)
- Their invoices arrive with batches, schemes, and multi-rate GST
- Payment terms are fixed (30/45/60 days from invoice date)
- Scheme terms per vendor need to be recorded (so the system can verify whether the correct scheme was applied)

**Key views:**
- **Payables outstanding** — what's due to each vendor, by invoice, with due dates
- **Upcoming payments** — amounts due in the next 7/14/30 days (cash flow planning)
- **Vendor-specific price list / scheme log** — record active schemes so GRN entry can auto-apply and flag discrepancies
- **Purchase history** — what was bought from this vendor, which batches, at what price

**Gap today:** Vendors are stored in `ledgers` (type = "vendor") but the vendor-specific workflows (payables aging, scheme log, PO flow) are not built.

---

## Tier 2 — Complete (replaces Marg)

### 7. Payments & Accounts

**What:** Recording and tracking the flow of money — in from customers, out to vendors.

**Payment receipt (inward):**
- Record payment from a customer: amount, mode (cash / cheque / UPI / NEFT / RTGS), reference number, date
- Apply against specific open invoices (or auto-apply oldest-first)
- Print/WhatsApp receipt

**Payment to vendor (outward):**
- Record payment to a distributor, against specific purchase invoices
- Track cheque numbers, NEFT UTR references
- Upcoming payments alert (cash flow view)

**Credit and debit notes:**
- Credit note: issued to customer when they return goods; reduces their outstanding
- Debit note: raised to vendor when returning goods; reduces what Santosh owes them
- Both must link to the originating invoice and the return transaction

**Bank reconciliation:**
- Import bank statement (CSV); auto-match against recorded payments
- Flag unmatched entries (payments received but not recorded, or vice versa)

**Razorpay integration:** Generate a payment link for a customer's outstanding; send via WhatsApp. Payment confirmation auto-applies against their ledger.

---

### 8. Returns

**What:** Structured reverse flows for both sales returns (chemist returns goods) and purchase returns (Santosh returns to distributor). Returns are high-frequency in pharma due to expiry, breakage, and distributor recalls.

**Sales return (from customer):**
- Reference the original sale invoice
- Select items/batches being returned, quantity
- System generates credit note, re-stocks the batch, reduces customer receivable
- GST: credit note adjusts outward GST liability in GSTR-1

**Purchase return (to vendor):**
- Reference the original GRN
- Select items/batches being returned
- System generates debit note, decrements batch stock, reduces vendor payable
- GST: ITC reversal pre-calculated for the returned quantity
- If batch is past the vendor's return window and must be destroyed: write-off with full ITC reversal

**Why this is non-trivial:** A partial return (5 of 30 strips returned from a batch with a trade discount scheme and scheme free goods) requires careful re-computation of the net purchase value, the GST paid, and the revised ITC. No current ERP gets this fully right.

---

### 9. GST & Compliance

**What:** All GST filing, reconciliation, and statutory register requirements. For the target customer, this is the module that replaces the accountant's Excel.

**GSTR-1 (outward supplies):**
- Auto-computed from persisted sales invoices
- B2B: party-wise invoice listing with GSTIN
- B2C: aggregate summary above/below ₹2.5L
- HSN-wise summary (4-digit for < ₹5 Cr; 6-digit above)
- Export as GSTN-compatible JSON for portal upload
- Credit notes included

**GSTR-3B (summary return):**
- Outward tax liability (from sales)
- ITC claimed (from GRN / purchases)
- ITC reversal (from returns, expired stock)
- Net tax payable
- Export for manual entry or API push via GSP (ClearTax free tier — per PRD)

**GSTR-2B reconciliation (differentiator):**
- Import GSTR-2B (the auto-populated ITC statement from the GST portal) as JSON/CSV
- Auto-match each line against local purchase entries by: vendor GSTIN + invoice number + date + amount
- Surface mismatches: lines in GSTR-2B with no local GRN (maybe a distributor billed the wrong GSTIN), lines in local GRN with no GSTR-2B entry (distributor filed late)
- Let the accountant resolve each mismatch: accept, reject, or flag for distributor follow-up
- Calculate net claimable ITC vs. claimed ITC — flag over-claim risk

**ITC tracking and reversal:**
- Each GRN line records ITC: `gst_paise` at purchase
- Each batch knows its full ITC amount
- When a batch is returned / expired / destroyed: system pre-fills the reversal amount
- Reversal feeds into GSTR-3B for that month

**Schedule H1 register:**
- Every H1 sale is captured at the billing gate (see Counter module)
- The register is a dated, filterable ledger: serial no, date, doctor, patient, drug, qty, batch, expiry, pharmacist
- Export as PDF (formatted for drug inspector presentation) for any date range
- Export as Excel for record-keeping

**Drug license renewal alerts:**
- Store each drug license number, expiry date, license type (Form 20, 20B, 20F, etc.)
- Alert owner at 90 days, 60 days, 30 days before expiry
- Show as persistent banner on the owner dashboard until renewed

**E-invoicing (for businesses above ₹5 Cr AATO):**
- IRN (Invoice Reference Number) generation via NIC's IRP API
- QR code on invoice
- Auto-detect turnover threshold; switch to e-invoicing mode when crossed

---

### 10. Reports & Analytics

**What:** Standard reports the owner needs daily/weekly/monthly, and the owner dashboard as the first screen after login.

**Owner dashboard (live):**
- Today's sales total (invoices × grand total)
- Cash vs. credit split
- Top 10 items sold today
- Overdue receivables (> 30 days) — total amount + count of parties
- Near-expiry alerts — count of batches expiring in 30/60 days
- Drug license expiry status

**Sales reports:**
- Daily sales register (all invoices, party-wise, item-wise)
- Monthly sales summary (GST-rate-wise, HSN-wise, party-wise)
- Item movement report: which SKUs sold, in what quantity, at what margin
- Party-wise sales: top customers, buying frequency, last purchase date

**Purchase reports:**
- GRN register: all purchases, vendor-wise, item-wise
- Vendor-wise purchase summary
- Scheme tracking: schemes applied vs. expected; discrepancy flag

**Inventory reports:**
- Stock ledger: current qty, batch-wise, with MRP and cost
- Near-expiry report: batches expiring within configurable window; exportable to send to distributor for return claim
- Slow / dead stock: items with < X units sold in last Y days
- Reorder report: items below reorder point

**Financial reports:**
- Receivables aging: 0–30 / 31–60 / 61–90 / 90+ days per customer
- Payables aging: same for vendors
- Gross margin: sales − cost of goods sold, item-wise and overall
- Outstanding collection summary

**Compliance reports:**
- Schedule H1 register (see GST module)
- GST summary (GSTR-1/3B)
- HSN-wise sales summary
- ITC register (batch-level ITC tracking)

---

## Tier 3 — Differentiate (better than Marg)

### 11. Expiry Management

A first-class module, not buried in inventory. Near-expiry stock is a direct loss for the owner.

- **Proactive surfacing at billing:** "3 batches of Augmentin 625mg expire in 45 days. Prioritise these?" — shown on the billing screen before the item is added to a bill
- **Return-to-supplier workflow:** generates debit note, tracks distributor's credit note back, settles payable
- **Write-off workflow:** marks batch as destroyed; pre-computes ITC reversal; creates accounting entry
- **Near-expiry dashboard:** ranked list of batches by days-to-expiry × remaining qty × MRP value (prioritises high-value expiring stock)

### 12. Schedule H / H1 / X Compliance (hard gates)

Described in the Counter module as a gate, but the full module includes:

- **Item-level scheduling:** each item tagged H / H1 / X / OTC (already in schema)
- **H1 gate at billing:** mandatory fields form blocks invoice — doctor name, patient name, patient address, batch number, quantity, pharmacist confirmation
- **H1 register:** a clean, auditable log; exportable PDF with date-range filter; each line signed (pharmacist username + timestamp)
- **X-drug block:** X drugs cannot be billed unless the org has an active Form 20F license recorded; billable only by pharmacist role
- **Prescription upload:** image/PDF attached to the sale; stored per invoice; retrievable during inspection

### 13. GSTR-2B Auto-Reconciliation

Described in the GST module — surfaced here as a differentiator because no competitor offers it. Monthly reconciliation is a 2–4 accountant-day task. Automating it is a concrete, demonstrable time-saver.

### 14. WhatsApp Integration

- **Invoice sharing:** one-click WhatsApp share of the invoice PDF (or formatted text) to the customer's number on their ledger
- **Payment reminder:** templated WhatsApp message with outstanding amount + optional Razorpay payment link
- **Ledger statement:** send the customer's account statement (last 30/60/90 days) via WhatsApp
- **Near-expiry push to vendor:** "We have 500 strips of Cephalexin 500mg (Batch: CEP2410, Exp: Aug-2026) — initiating return claim" — one-click WhatsApp to the distributor rep

### 15. Drug License Renewal Alerts

Trivial to build; missing from every competitor; catches attention in demos. Store license numbers with expiry dates, alert at 90/60/30 days, show as dashboard banner.

### 16. Salesman Management

For wholesale dealers like Santosh who have field salesmen visiting retail chemists:
- Salesman master (name, territory, mobile)
- Orders taken by salesman linked to their ID
- Salesman-wise sales report and commission calculation
- Outstanding receivables collected by salesman

---

## Tier 4 — Enterprise / Future

### 17. Multi-store

Central stock control, inter-store transfers, HQ dashboard, consolidated GST filing across stores. Requires schema changes (current model: one org = one shop).

### 18. B2B Ordering Portal

ERP-to-ERP ordering: the pharmacy sees the distributor's live stock, prices, and active schemes inside Salt and places a purchase order electronically. Eliminates the WhatsApp order cycle.

### 19. Purchase Invoice OCR

AI auto-fill: point phone camera at a paper distributor invoice; Salt extracts item, batch, qty, MRP, PTR, GST. Saves 30–60 minutes of daily manual GRN entry. Marg already does this — it must be matched.

### 20. ABHA / ABDM Integration

Link each sale to the patient's ABHA health ID. Generates referral traffic from hospitals/clinics in the ABDM network. eVitalRx already has NHA approval.

### 21. ONDC

List the pharmacy's stock on the ONDC network; fulfill online orders through Salt. eVitalRx is first. Enables independents to compete with PharmEasy/Apollo without a commission.

---

## Build sequence (recommended)

| Phase | Modules | Outcome |
|---|---|---|
| **Now** | Billing persistence + GRN/Purchase | Can run the business day-to-day |
| **Phase 2** | Payments + Customer credit + Returns | Can do end-of-day financial reconciliation |
| **Phase 3** | GST export + H1 register + Print | Can replace Marg entirely |
| **Phase 4** | GSTR-2B reconciliation + Expiry workflow + WhatsApp + Drug license alerts | Strictly better than Marg |
| **Phase 5** | Offline-first sync + Multi-counter real-time | The strategic wedge — what no competitor has |
| **Phase 6** | Multi-store + Purchase OCR + ABHA + ONDC | Enterprise and growth surface |

**The critical unlock is Phase 1.** Until `sales` and `purchase_lines` tables exist and bills persist, nothing downstream works. Payments, GST, reports, receivables — all require persisted sales data. This is the next thing to build.

## Related
[product/prd](prd.md) · [product/roadmap](roadmap.md) · [product/market-research](market-research.md) · [domain/persona-wholesale-owner](../domain/persona-wholesale-owner.md) · [architecture/data-model](../architecture/data-model.md) · [domain/medical-retail](../domain/medical-retail.md)
