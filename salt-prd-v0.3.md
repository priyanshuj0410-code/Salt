# Product Requirements Document
## Salt — Cloud-first ERP for Medical Retail

**Status:** Draft v0.3
**Author:** Founder (drafted with Claude)
**Last updated:** 28 May 2026
**Target launch:** Q1 2027 (9–12 months)
**Funding posture:** Bootstrapped

### Changelog
- **v0.3 (28 May)** — Name locked as **Salt**. Q11–Q15 resolved: self-host Liveblocks/Yjs; capped WhatsApp messaging; GST e-invoicing threshold confirmed acceptable; CA to advise on crowd-sourced data legal posture
- **v0.2 (28 May)** — Founder decisions incorporated: bootstrapped, ₹499 pricing (with concerns noted), open-source drug DB, free-tier GSP, customer hardware only, Razorpay only, CA arrangement secured, pilot shops confirmed available
- **v0.1 (28 May)** — Initial draft

---

## 0. Document conventions

- **MUST** = required for v1 launch
- **SHOULD** = strongly preferred for v1, may slip to v1.1 if scope pressure mounts
- **WON'T (v1)** = explicit non-goal, deferred to v2 or later
- *Italic* notes are open questions or rationale, not requirements
- All currency in INR. All times in IST.
- "Shop" = a single physical retail location. "Org" = a customer entity that may own one or more shops.

---

## 1. Executive summary

Indian medical retail (~850,000 chemist shops, ~₹2.5 lakh crore annual revenue) is run on software that hasn't fundamentally changed in 20 years. Marg ERP 9+ dominates this market with an estimated 20–25% share, alongside Tally, Vyapar, and dozens of regional players. These tools work but are deeply unfriendly: keyboard-only DOS-era UIs, single-user assumptions, no real multi-counter coordination, no offline-online story that actually holds up, and configuration mazes that take days to learn.

**Salt is a modern, multi-shop, real-time, offline-resilient ERP purpose-built for Indian medical retail** — chemists, surgicals, and ayurveda outlets. We target multi-user shops first (where the pain is highest) and chains as a v1 capability, with broad medical retail scope rather than pharma-only.

> The name "Salt" comes from how Indian pharmacy actually talks. Every cashier and chemist asks "iska salt kya hai?" ("what's the salt?") to mean *what's the active molecule?* — it's the vocabulary the customer already lives in. The product is built on the same idea: salt-based search, salt-equivalent substitutes, salt as the unifying primitive across allopathy and ayurveda. The brand and the product mechanics tell the same story.

### Strategic bet

The wedge is **multi-counter coordination**. Existing tools treat each counter as an isolated install with file-share data; ours treats the shop as a live, collaborative workspace. From that wedge we extend to inventory health, customer-wise pricing, payments, and tax/GST planning — areas where Marg works but exposes the right answers behind too many clicks.

### What success looks like (v1)

- **1,000+ paying shops** at end of month 12 post-launch
- **80%+ of customers** migrated from Marg or Tally (i.e., we're displacing, not just net-new)
- **<10 minute** median time from signup to first bill (real onboarding, not white-glove)
- **<2 minute** median time-to-checkout for a 5-item bill (counter staff)
- **<1% data loss** events across all customers' transaction history per month
- **NPS ≥ 40** at 3 months on platform

### Critical constraints to be honest about

- **Team:** solo founder + contractors. This shapes everything downstream — we can't ship six integrations in parallel, can't manually onboard 1,000 customers, can't run 24/7 phone support.
- **Funding:** bootstrapped. Every spend decision must pencil out against revenue projections. Marketing budget is small, engineering hires are contractors, support is small. **At ₹499 ARPU × 1,000 customers = ~₹60L ARR by end of year 1** — enough to sustain a small operation, not enough for aggressive expansion. Year 2 needs price-tier expansion or higher-tier upsells.
- **Timeline:** 9–12 months. Significantly less than what existing ERPs took to build, but achievable because we're not rebuilding accounting from scratch — we're rebuilding the UX layer and the multi-user/sync substrate on top of well-understood domain logic.
- **Scope:** broad medical retail (allopathic + surgical + ayurveda) is more ambitious than pharma-only. The data model and master DB need to flex for non-allopathic items from day one, not be retrofitted.
- **Pricing:** ₹499 flat, no tiers. Margin is tight; revisit at 100 customers (see §8.2 for explicit triggers).

---

## 2. Problem & customer

### 2.1 The customer

**Primary persona: The Owner-Operator of a multi-counter medical store.**

- Runs 1–4 retail shops, each with 2–4 billing counters
- 5–25 staff total: cashiers, pharmacists, an accountant, sometimes a delivery person
- Annual GMV ₹50 lakh – ₹15 crore per shop
- Owner is hands-on; spends 4–8 hours/day in the shop; reviews books nightly
- Tech comfort: high enough to operate Marg/Tally; uses WhatsApp daily; banks online; not a software professional
- Pays for ERP because compliance forces them to (GST, drug license), but quietly wants the data to actually help them run the business

**Secondary personas:**

- **Cashier (counter staff):** young, learns fast, but rotates between shops; speed-of-billing is their job. Doesn't care about features; cares about not getting yelled at by waiting customers.
- **Pharmacist (qualified):** stocks items, verifies Schedule H/H1 sales, handles substitutes; technically responsible for compliance.
- **Accountant / back-office:** part-time at smaller shops, full-time at chains; handles GST filing, ledger reconciliation, supplier payments.
- **External CA:** monthly visitor, needs clean export to Tally or direct GST filing data.

### 2.2 The pain

Existing software (Marg, Tally, RetailGraph, etc.) does the *jobs* but exposes them through interfaces that compound friction across a workday. The specific pains we're targeting:

1. **Counter billing is fast for experts, brutal for everyone else.** A 3-month employee bills at half the speed of a 3-year veteran because the UI rewards memorized keystroke chains, not intuition.
2. **Multi-user is bolted-on, not real.** Two counters selling the same medicine can over-commit stock; one counter doesn't see what the other just billed; staff handoffs lose state.
3. **Inventory health is reactive, not predictive.** Owners discover near-expiry stock when the bill rejects, not 30 days in advance. Dead stock builds up silently.
4. **Customer-wise pricing rules exist but are unmaintainable.** Setting Dr. Patel's 8% discount on GSK plus 5% on insulin requires navigating three screens; auditing what's currently set requires patience.
5. **GST filing is a fire drill every month.** The data is in the system but the reports need cleanup and reformatting before they can be filed; mismatches with GSTR-2A are caught late.
6. **Migration cost** keeps people on tools they hate. "Switching means re-entering 5,000 items" → "we'll switch next year" → never switches.

### 2.3 Why now

Three forces converged in 2024–2026 that make this product possible and timely:

- **CRDT-based sync** (Yjs, Liveblocks, ElectricSQL) matured enough that local-first multi-user is no longer a research project — Figma, Linear, and Notion proved the patterns work in production
- **UPI ubiquity** changed payment behavior at the counter — split payments and digital receipts are now table stakes
- **GST compliance pressure increased** with e-invoicing thresholds dropping and GSTR-2A reconciliation getting stricter — owners now feel monthly pain that they previously felt quarterly

---

## 3. Goals & non-goals

### 3.1 Goals (v1)

- **G1.** Deliver counter billing that's ≥ as fast as Marg for trained users and ≥ 3× faster than Marg for new users
- **G2.** Make multi-counter coordination feel native (live stock, presence, handoff, conflict resolution)
- **G3.** Provide inventory health intelligence (near-expiry, low stock, dead stock, reorder suggestions) by default, not as a paid add-on
- **G4.** Reduce monthly GST close time from days to hours
- **G5.** Enable self-serve onboarding from existing Marg/Tally data via Excel/CSV in under 30 minutes
- **G6.** Support multi-shop chains in v1 with consolidated owner reporting
- **G7.** Operate offline at the counter for full business days, syncing when network returns
- **G8.** Cover allopathic pharma, surgical disposables, and ayurveda from v1

### 3.2 Non-goals (v1) — what we are explicitly NOT building

These are deferred deliberately. Each has a reason; revisit in v2 planning.

- **N1. `.mbk` (Marg native backup) direct parsing.** Excel/CSV import path is sufficient for migration; reverse-engineering the proprietary backup is a 3–6 month project that doesn't move sales. Reconsider after 200 customers.
- **N2. Native mobile/tablet counter app.** Counter PCs are the dominant form factor. A web app that *works* on tablets is fine; a separately built native app is not v1.
- **N3. Native iOS/Android apps for owners.** A responsive web view of dashboards is enough. Native apps after we know which views owners actually open on mobile.
- **N4. Hospital pharmacy mode** (inpatient billing, ward stock, MR samples). Different workflow, different sales motion. Distinct future SKU.
- **N5. Manufacturing / compounding.** Some ayurveda outlets manufacture in-house; we serve retail of finished goods only in v1.
- **N6. POS hardware bundling.** We sell software; customers bring their own counter PC, printer, barcode scanner. Maintain a tested compatibility list, no exclusive hardware.
- **N7. Custom report builder UI.** Ship the ~30 reports that cover 95% of use cases. Custom report writer is a v2 feature.
- **N8. White-glove migration for all customers.** At 1,000-customer scale, white-glove only for the first 50–100 strategic accounts; rest must self-serve.
- **N9. E-commerce / B2C ordering app for end customers.** Some shops want to take WhatsApp/online orders — we'll surface basic order intake, but a customer-facing branded app is not v1.
- **N10. Loyalty programs and customer rewards.** Real demand but complex; defer.
- **N11. Multi-currency.** India only.
- **N12. Multi-language UI for v1.** English + Hindi only. Regional languages (Tamil, Telugu, Marathi, Gujarati) in v1.1.
- **N13. Accounting beyond pharmacy needs.** We do GST, ledgers, P&L, balance sheet, expense tracking — i.e., enough for a CA to take over. Full enterprise accounting (cost centers, project accounting, asset depreciation schedules) is out.
- **N14. Custom GST rate engines for special goods.** Standard rates only. Composition scheme not v1.
- **N15. 24/7 voice support.** Chat + email support during business hours, with knowledge base. Voice for emergencies on a paid tier.

### 3.3 Anti-goals — what success does NOT look like

- Becoming a generic ERP that serves any retail vertical (we are medical-retail-specific by design)
- Featuring our way to parity with Marg (the wedge is *how* not *what*)
- A "platform" with marketplaces, app stores, third-party plugins (defer indefinitely)

---

## 4. Functional requirements

This is the meat of the document. I've organized by major surface, with each requirement tagged MUST/SHOULD and given a unique ID for tracking.

### 4.1 Counter billing (Sales)

The most important surface. Everything else can be slightly inferior to Marg; this must be clearly superior.

#### Bill creation

- **FR-S-001 (MUST):** Cashier can start a new bill in 0 actions — billing screen is the default landing for cashier role.
- **FR-S-002 (MUST):** Bill creation auto-assigns a sequential invoice number in the shop's configured GST series.
- **FR-S-003 (MUST):** Each bill is tied to one customer (default: Walk-in). Customer can be changed mid-bill via `Ctrl+K` picker.
- **FR-S-004 (MUST):** Multiple bills can be in progress on the same counter (held/parked). A counter sees its own parked bills in a sidebar.
- **FR-S-005 (SHOULD):** Parked bills can be transferred to another counter in the same shop (handoff).

#### Item entry

- **FR-S-010 (MUST):** Fuzzy search by medicine name OR salt/molecule OR HSN OR barcode in a single input. No mode switching.
- **FR-S-011 (MUST):** Search ranks by: (a) in-stock first, (b) sales velocity for this shop, (c) string match strength.
- **FR-S-012 (MUST):** Search results show: name, salt, manufacturer, pack, stock count, MRP, Schedule label (H/H1/X) inline.
- **FR-S-013 (MUST):** Out-of-stock items appear with substitutes inline (same salt, in-stock, sorted by margin then sales velocity).
- **FR-S-014 (MUST):** `Enter` adds highlighted item with qty 1 at FEFO batch.
- **FR-S-015 (MUST):** Adding the same item again increments qty rather than creating a new line.
- **FR-S-016 (MUST):** Different batches of the same item appear as separate lines.
- **FR-S-017 (MUST):** Cashier can override batch via inline picker showing all in-stock batches with expiry, qty, MRP.
- **FR-S-018 (SHOULD):** Loose-unit sale support: cashier can sell 4 tablets from a strip of 10, with auto-calculated proportional price. Unit-of-sale rules per item.
- **FR-S-019 (MUST):** Bill items can be reordered, edited inline (qty, discount), or deleted without restarting the bill.

#### Pricing & discounts

- **FR-S-020 (MUST):** Each line auto-applies the most-specific customer pricing rule (see §4.4). Auto-discount is visually distinct from manual override.
- **FR-S-021 (MUST):** Cashier can override discount per line. Manual override is "sticky" — switching customer mid-bill doesn't re-apply rules to manually-edited lines.
- **FR-S-022 (MUST):** Discount can be % or flat ₹ per line, and applied at bill level.
- **FR-S-023 (MUST):** GST is computed inclusive of MRP (Indian convention for pharma). Cashier never enters GST manually.
- **FR-S-024 (SHOULD):** Discount above configurable threshold (default ₹500 or 15%) requires manager approval before save. Approval via owner's device in real time.

#### Schedule H/H1/X (regulated drugs)

- **FR-S-030 (MUST):** Adding a Schedule H/H1/X drug auto-exposes prescription capture fields *inline*: doctor name, registration number, prescription date, patient name & address.
- **FR-S-031 (MUST):** Bill cannot be saved with regulated drugs without these fields filled (validation enforced).
- **FR-S-032 (MUST):** Schedule H1 sales auto-record in a separate digital register, exportable for drug inspector visits.
- **FR-S-033 (SHOULD):** Doctor & patient suggestions auto-complete from prior captures.

#### Payment

- **FR-S-040 (MUST):** Payment screen supports Cash + UPI + Card + Credit splits.
- **FR-S-041 (MUST):** Cashier can leave bill on credit (full or partial). Customer credit ledger updates immediately on save.
- **FR-S-042 (MUST):** Change-to-return is computed and displayed live as cashier enters tender amounts.
- **FR-S-043 (MUST):** Bill cannot be saved with unaccounted-for amount (paid < total without credit being explicitly chosen).
- **FR-S-044 (SHOULD):** UPI flow integrates with payment gateway to auto-confirm payment (no manual "yes UPI received" toggle).

#### Print & share

- **FR-S-050 (MUST):** Save & Print is a single action — saves bill, decrements stock, prints to default printer.
- **FR-S-051 (MUST):** Print supports thermal (58mm, 80mm), A4, and dot-matrix output. Printer driver chosen at shop config; cashier doesn't see paper-size settings.
- **FR-S-052 (MUST):** Bill can be reprinted later from history without altering original.
- **FR-S-053 (MUST):** Bill can be shared as WhatsApp / SMS / email link without printing.
- **FR-S-054 (SHOULD):** Customer auto-receives a digital copy if their phone number is on file.

#### Returns

- **FR-S-060 (MUST):** Sales return against original bill: cashier searches the bill, marks items being returned, system handles stock + ledger + GST reversal automatically.
- **FR-S-061 (MUST):** Sales return without original bill (rare but real): cashier creates a return bill manually with reason capture.
- **FR-S-062 (MUST):** Returned items decrement back into stock with their original batch.

#### Keyboard

- **FR-S-070 (MUST):** Every action on the billing screen is reachable by keyboard. No mouse-required flows.
- **FR-S-071 (MUST):** Shortcut hints visible inline (not hidden in tooltips).
- **FR-S-072 (MUST):** `?` opens a complete shortcut reference; new staff can self-teach.
- **FR-S-073 (SHOULD):** Shortcut customization in user settings.

### 4.2 Purchase / Goods Receipt (GRN)

Second most-used surface for the pharmacist role.

#### Purchase order (PO)

- **FR-P-001 (MUST):** Manual PO creation: select supplier, add items with qty.
- **FR-P-002 (MUST):** Auto-PO suggestions based on reorder levels and sales velocity. Owner reviews before sending.
- **FR-P-003 (SHOULD):** PO can be sent to supplier via WhatsApp, email, or distributor API (see §4.7).

#### GRN (receiving stock)

- **FR-P-010 (MUST):** Manual GRN entry: scan/type each item, capture batch, expiry, qty received, free qty, MRP, PTR, GST, scheme.
- **FR-P-011 (MUST):** Match-to-PO: GRN auto-fills from open PO; pharmacist confirms or amends each line.
- **FR-P-012 (MUST):** Match-to-invoice: supplier's invoice and GRN are reconciled. Any mismatch (qty, rate, missing item) is flagged for the owner.
- **FR-P-013 (MUST):** Scheme entry (e.g., "10+1") affects effective cost calculation correctly. Schemes are line-level, not bill-level.
- **FR-P-014 (MUST):** New items not in master DB are flagged for review; cannot be silently added.
- **FR-P-015 (SHOULD):** Bulk GRN import from supplier's emailed invoice PDF (OCR-assisted).

#### Purchase returns

- **FR-P-020 (MUST):** Mark items as damage / expired / surplus / wrong-shipment; system handles stock and supplier ledger.
- **FR-P-021 (MUST):** Generate purchase return note for supplier.

### 4.3 Inventory

#### Master items

- **FR-I-001 (MUST):** Pre-seeded national drug master DB with ~20,000–25,000 SKUs covering allopathic pharma, common surgicals, and major ayurveda brands. **Built from open sources** (CDSCO drug approval data, public ayurveda formularies, GSTN HSN data) rather than commercial licensing — see §6.5 for sourcing plan.
- **FR-I-001a (MUST):** Master items have **identity fields populated** (name, salt, manufacturer, HSN, GST%, schedule, pack format) but **pricing fields empty** (MRP, PTR). Customers enter pricing on first GRN; system learns and refines over time.
- **FR-I-001b (SHOULD):** **Crowd-sourced pricing intelligence:** when shops enter MRP/PTR on their GRNs, aggregated/anonymized data refines master DB suggestions for future customers. This becomes a network effect that compounds with scale — a genuine moat versus Marg.
- **FR-I-002 (MUST):** Master items are versioned; updates push to all shops with audit trail.
- **FR-I-003 (MUST):** Shops can add custom items not in master DB. Custom items can be promoted to master DB on review.
- **FR-I-004 (MUST):** Each item has: name, alt names, salt/molecule (allopathic), manufacturer, pack, MRP, PTR, HSN, GST%, schedule, barcode(s), category, substitutes.
- **FR-I-005 (MUST):** Non-allopathic items (surgicals, ayurveda) have a flexible schema — salt may be empty, schedule does not apply, but the same UI handles them gracefully.

#### Stock tracking

- **FR-I-010 (MUST):** Stock is tracked at batch level: every batch has qty, expiry, MRP at receipt, PTR at receipt.
- **FR-I-011 (MUST):** Stock decrements on sale (FEFO default), increments on GRN, adjusts on return.
- **FR-I-012 (MUST):** Stock changes are atomic across counters — selling the last unit on Counter 1 prevents Counter 2 from over-committing.
- **FR-I-013 (MUST):** Stock adjustments (breakage, theft, physical count diff, expired write-off) require reason and audit log entry.
- **FR-I-014 (MUST):** Multi-shop: each shop has its own stock; inter-shop transfers are first-class operations.

#### Inventory health

- **FR-I-020 (MUST):** Near-expiry dashboard: items with batches expiring in 1/3/6 months, sortable by value.
- **FR-I-021 (MUST):** Low-stock dashboard: items below reorder level, with sales-velocity-based reorder suggestions.
- **FR-I-022 (MUST):** Dead-stock dashboard: items with no sale in N days (configurable, default 90).
- **FR-I-023 (MUST):** Out-of-stock list with last-sold date and "would have sold" estimate based on historical velocity.
- **FR-I-024 (SHOULD):** Stock turnover ratio per item / category / supplier.
- **FR-I-025 (SHOULD):** Expiry destruction workflow with witness signature capture and PDF documentation.

### 4.4 Customers & pricing rules

#### Customer master

- **FR-C-001 (MUST):** Customer record: name, phone, address (optional), GSTIN (optional), group (Walk-in / Regular / Doctor / Wholesale / Corporate / custom), default discount %, credit limit, opening balance.
- **FR-C-002 (MUST):** Walk-in is a built-in customer; cannot be deleted; doesn't accumulate per-customer history.
- **FR-C-003 (MUST):** Customer search is fuzzy by name OR phone OR group.
- **FR-C-004 (SHOULD):** Optional chronic-condition / allergies / regular medicines field for patient-facing shops that do refill reminders.

#### Pricing rules

- **FR-C-010 (MUST):** Per-customer rules at three scopes: specific product, salt/molecule, manufacturer. Most-specific wins.
- **FR-C-011 (MUST):** Per-customer default discount applies when no rule matches.
- **FR-C-012 (MUST):** Rules editor shows a live preview of rule resolution for sample products.
- **FR-C-013 (MUST):** Rules apply automatically at billing; cashier sees *why* each line has its discount.
- **FR-C-014 (SHOULD):** Group-level rules (apply to everyone in "Doctors" group unless overridden by individual rule).
- **FR-C-015 (WON'T v1):** Time-bound rules ("10% off July only"), tiered rules ("qty > 100 gets 15%"), stacked rules.

#### Credit & receivables

- **FR-C-020 (MUST):** Customer credit limit; warning when bill would exceed it.
- **FR-C-021 (MUST):** Per-customer ledger of bills, payments, returns.
- **FR-C-022 (MUST):** Aging buckets: 0–30 / 31–60 / 61–90 / >90 days, with totals per bucket.
- **FR-C-023 (SHOULD):** Payment reminder via WhatsApp at owner's discretion (not auto).

### 4.5 Payments

#### Receivables (customer payments to us)

- **FR-PAY-001 (MUST):** Record payment from customer: amount, mode (cash/UPI/card/cheque/bank transfer), reference number, against which bills (auto-allocation oldest-first by default, customer-selectable override).
- **FR-PAY-002 (MUST):** Partial payments allowed; system tracks unallocated amount as advance.
- **FR-PAY-003 (MUST):** Payment receipts can be printed or shared.

#### Payables (us to suppliers)

- **FR-PAY-010 (MUST):** Record payment to supplier; allocate against invoices.
- **FR-PAY-011 (MUST):** Outstanding payable dashboard with due-date sort, overdue highlighting.
- **FR-PAY-012 (SHOULD):** Cheque book tracking, post-dated cheque management.

#### Cash drawer

- **FR-PAY-020 (MUST):** Per-counter, per-shift cash drawer reconciliation: opening cash, sales-in-cash, payouts, closing cash, variance.
- **FR-PAY-021 (MUST):** Cashier closes their drawer at end of shift; system flags variance > ₹100 (configurable) for manager review.

#### Bank reconciliation

- **FR-PAY-030 (SHOULD):** Import bank statement (CSV/PDF), auto-match to recorded payments, surface unmatched items.
- **FR-PAY-031 (WON'T v1):** Account Aggregator integration for auto-pull. Defer to v1.1.

### 4.6 Tax & GST

#### Routine tax handling

- **FR-T-001 (MUST):** GST extracted automatically from MRP-inclusive pricing at every sale.
- **FR-T-002 (MUST):** Tax handled correctly across CGST/SGST/IGST (intra-state vs inter-state).
- **FR-T-003 (MUST):** HSN-wise tracking on every sale; HSN summary report auto-generated.
- **FR-T-004 (MUST):** Multiple GST series (e.g., regular bills + cash bills + B2B) supported per shop.

#### Filing

- **FR-T-010 (MUST):** GSTR-1 (outward supplies) generation: B2B, B2C-S, B2C-L, HSN summary tables.
- **FR-T-011 (MUST):** GSTR-3B (summary return) generation.
- **FR-T-012 (MUST):** GSTR-2A reconciliation: import 2A from GSTN, match against our purchase records, surface mismatches by amount and supplier.
- **FR-T-013 (MUST):** All returns exportable as JSON for upload to GSTN or as Excel for CA review.
- **FR-T-014 (SHOULD):** Direct GSTN API filing (one-click submit). Requires GSTN API credentials per shop.
- **FR-T-015 (SHOULD):** Tally export of all transactions (in Tally's XML import format) for CAs who use Tally.

#### Tax planning

- **FR-T-020 (MUST):** Live "current month liability" view with output GST, ITC, net payable.
- **FR-T-021 (MUST):** Cash flow planning: highlight upcoming GST payment due date alongside other scheduled outflows.
- **FR-T-022 (SHOULD):** Year-over-year, month-over-month liability comparison.

### 4.7 Integrations

In v1, all six are scoped. Sequencing is in §6.

- **FR-INT-001 (MUST):** GSTN APIs — GSTR-1 / 3B filing, 2A pull. Tax filing is bet-the-business; ship in v1.
  - **Implementation strategy (v0.2):** Use **ClearTax free tier** for first 100–200 customers (sufficient for low-volume filers). Migrate to a paid GSP (IRIS Cygnet at ~₹5–20 per filing, or similar) as we scale. Direct GSP licensing is not v1 — it consumes 4–6 months of founder time for no product differentiation.
- **FR-INT-002 (MUST):** Payment gateway — UPI/cards via Razorpay or similar. Direct sales impact.
- **FR-INT-003 (MUST):** WhatsApp Business — bill sharing, payment reminders, order confirmations. Massive UX win.
- **FR-INT-004 (MUST):** Tally export — XML format for CAs. Removes a switching objection ("but my CA uses Tally").
- **FR-INT-005 (SHOULD):** Distributor APIs — start with 2–3 largest distributors (MedPlus, etc.). Auto-PO and auto-GRN match. High value but each integration is custom.
- **FR-INT-006 (SHOULD):** Bank reconciliation via Account Aggregator. Mature tech; OK to slip to v1.1.

### 4.8 Multi-shop & user management

#### Org & shops

- **FR-U-001 (MUST):** An Org owns one or more Shops. Single-shop customers default to Org = Shop, no extra config required.
- **FR-U-002 (MUST):** Cross-shop reports: consolidated sales, stock, P&L visible to Org owner.
- **FR-U-003 (MUST):** Per-shop GST registration, drug license, bank account, printer config.
- **FR-U-004 (MUST):** Inter-shop stock transfer: move stock from Shop A to Shop B with audit trail.
- **FR-U-005 (SHOULD):** Centralized item master at Org level; per-shop overrides where needed (e.g., shop A doesn't stock surgicals).

#### Users & roles

- **FR-U-010 (MUST):** Roles: Owner, Manager, Pharmacist, Cashier, Accountant. Each has a default permission set.
- **FR-U-011 (MUST):** Per-user scoping: a Cashier at Shop A cannot see Shop B's data.
- **FR-U-012 (MUST):** Permission overrides per user (e.g., allow this specific cashier to issue refunds).
- **FR-U-013 (MUST):** Login via phone+OTP or email+password. Per-user activity audit log.
- **FR-U-014 (SHOULD):** SSO via Google Workspace for Orgs that want it.

#### Real-time collaboration (the differentiator)

- **FR-U-020 (MUST):** Presence: see who is logged in at which counter in real time.
- **FR-U-021 (MUST):** Live stock: when Counter 1 sells, Counter 2's view of that item's stock updates within 1 second on LAN.
- **FR-U-022 (MUST):** Conflict resolution: if two counters race to sell the last unit, one wins atomically and the other gets a clear "stock changed, please pick another batch" message.
- **FR-U-023 (MUST):** Activity feed: shop-wide stream of significant events (large sale, stock alert, large discount, refund). Filterable by user/shop/event type.
- **FR-U-024 (SHOULD):** Internal messages: short notes attached to bills, customers, or items, visible to staff.
- **FR-U-025 (SHOULD):** "Approve from manager's device" flow for sensitive actions (large discount, deletion).

### 4.9 Reports

Ship ~30 reports covering 95% of use cases. Owners can filter, sort, group, and export. Custom report builder is non-goal (N7).

**Sales reports**
- Daily sales summary
- Sales register (detailed list of bills)
- Item-wise sales (top sellers, bottom sellers)
- Category-wise sales
- Salesperson / cashier-wise sales
- Customer-wise sales
- Schedule H1 register
- Cancelled / returned bills

**Purchase reports**
- Purchase register
- Supplier-wise purchase
- Item-wise purchase
- Scheme/free-quantity report

**Inventory reports**
- Current stock
- Batch-wise stock
- Stock valuation (FIFO/weighted-avg)
- Near-expiry
- Dead stock
- Reorder list
- Stock movement (single item history)
- Physical count variance

**Financial reports**
- Outstanding receivables (with aging)
- Outstanding payables (with aging)
- Cash book
- Bank book
- Day book
- P&L (cash basis, accrual basis)
- Balance sheet
- Trial balance

**Tax reports**
- GSTR-1 preview
- GSTR-3B preview
- GSTR-2A reconciliation
- HSN summary
- Tax-rate-wise summary

### 4.10 Onboarding & migration

The 1,000-customer target requires this to be self-serve. This section is unusually detailed because it's the leverage point for the entire business plan.

- **FR-ON-001 (MUST):** Account creation in <2 minutes: phone, OTP, business name, GSTIN, drug license. Pre-fills shop details from GSTIN where possible.
- **FR-ON-002 (MUST):** Default shop config from GSTIN state (intra-state defaults, GST series naming convention, language).
- **FR-ON-003 (MUST):** Import from Excel: item master, customer master, supplier master, opening stock with batches, opening ledger balances. Each import has a template downloadable in one click.
- **FR-ON-004 (MUST):** Import preview before commit: show count of valid rows, list of failed rows with reason, ability to fix and re-upload.
- **FR-ON-005 (MUST):** Smart matching: when importing items, fuzzy-match to pre-seeded master DB to avoid duplication; user confirms ambiguous matches.
- **FR-ON-006 (MUST):** Marg-specific import templates: pre-shaped templates matching Marg's standard Excel export columns. Documented step-by-step: "In Marg, go to Reports → Item Master → Export → Excel".
- **FR-ON-007 (MUST):** Tally-specific import templates (same idea).
- **FR-ON-008 (MUST):** Setup wizard guides through: shop info → users → printer → first item import → first GRN → first sale. Skippable but recommended.
- **FR-ON-009 (SHOULD):** White-glove migration tier (paid or free for strategic accounts): we import and validate their data for them.
- **FR-ON-010 (SHOULD):** Onboarding completeness checklist visible until 100%; nudges for missing pieces.

### 4.11 Print

- **FR-PR-001 (MUST):** Thermal 80mm, thermal 58mm, A4, and dot-matrix supported for bills.
- **FR-PR-002 (MUST):** Print templates configurable per shop: logo, header, footer, terms-and-conditions, GSTIN display, drug license display, doctor signature field for Schedule drugs.
- **FR-PR-003 (MUST):** Bill template variants: cash memo, tax invoice, B2B invoice (with customer GSTIN), credit note, debit note, return.
- **FR-PR-004 (MUST):** GST-compliant tax invoice format per CGST Rules.
- **FR-PR-005 (SHOULD):** Bilingual print (English + Hindi/regional language) for customer-facing slips.

---

## 5. Non-functional requirements

### 5.1 Performance

- **NFR-P-001:** Counter billing search returns first results within 100ms (perceived instant).
- **NFR-P-002:** Saving a bill (local-first) completes within 200ms; sync to cloud happens async.
- **NFR-P-003:** Inventory list (10,000 items) renders within 500ms.
- **NFR-P-004:** Report generation for any single-month period completes within 5 seconds.
- **NFR-P-005:** App cold start on a counter PC (mid-spec, ~2018 hardware) within 3 seconds.

### 5.2 Reliability & data integrity

- **NFR-R-001:** Zero data loss tolerance for committed transactions. Local writes are durable before user sees "saved".
- **NFR-R-002:** Sync conflicts must resolve to a consistent state across all replicas. CRDT semantics for non-financial fields; explicit reconciliation flow for financial fields.
- **NFR-R-003:** Daily snapshot backups, retained 30 days. Point-in-time recovery within last 7 days.
- **NFR-R-004:** Audit log is append-only; cannot be edited or deleted via UI.

### 5.3 Availability & offline

- **NFR-A-001:** Counter must continue billing for full business days (12h+) without internet, syncing when network returns.
- **NFR-A-002:** Cloud platform target: 99.9% monthly uptime (~43 min downtime/month).
- **NFR-A-003:** When cloud is down, shop continues operating against local server; sync resumes automatically.

### 5.4 Security

- **NFR-S-001:** All data in transit encrypted (TLS 1.3).
- **NFR-S-002:** All data at rest encrypted (cloud DB + local server DB).
- **NFR-S-003:** No PII or financial data ever logged in plaintext.
- **NFR-S-004:** Role-based access enforced at API layer, not just UI.
- **NFR-S-005:** Multi-factor authentication mandatory for Owner role; recommended for Manager.
- **NFR-S-006:** GDPR-equivalent data export and deletion APIs for any customer who requests it.

### 5.5 Compliance

- **NFR-C-001:** GST compliance: all bills GST-compliant per CGST Rules.
- **NFR-C-002:** Drug & Cosmetics Act compliance: Schedule H/H1/X handling per DCA Rules.
- **NFR-C-003:** Data residency: customer data hosted in India.
- **NFR-C-004:** Audit trail satisfies drug inspector requirements (sales register, purchase register, narcotic register).

### 5.6 Scalability

- **NFR-SC-001:** Single shop scales to: 50,000 active items, 100,000 customers, 1,000,000 bills/year.
- **NFR-SC-002:** Single Org scales to: 100 shops, 10,000 bills/day across all shops, 500 concurrent users.
- **NFR-SC-003:** Platform scales to: 10,000 shops at v1 design; horizontal scaling path identified for 100,000.

### 5.7 Accessibility

- **NFR-AC-001:** Keyboard-navigable everywhere (already a core principle).
- **NFR-AC-002:** WCAG 2.1 AA contrast ratios on all primary surfaces.
- **NFR-AC-003:** Tested at zoom levels 100%, 125%, 150% (counter PCs often run zoomed-in).
- **NFR-AC-004:** UI usable on screen sizes from 13" laptop to 24" counter monitor.

---

## 6. Technical architecture (recommended)

This is a recommendation, not a requirement. Final stack decision is the founder + engineering call.

### 6.1 Architecture summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLOUD                                   │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│   │  API     │  │  Sync    │  │  Worker  │  │   Postgres   │    │
│   │  (NestJS)│  │ (Y-WS)   │  │ (Bull)   │  │  (managed)   │    │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘    │
│        │             │             │                │           │
│   ┌────┴─────────────┴─────────────┴────────────────┴─────┐     │
│   │            ElectricSQL / PowerSync layer              │     │
│   └────┬──────────────────────────────────────────────────┘     │
│        │                                                        │
└────────┼────────────────────────────────────────────────────────┘
         │ HTTPS + WebSocket (sync when online)
┌────────┼────────────────────────────────────────────────────────┐
│        │              SHOP LOCAL SERVER                         │
│   ┌────┴─────┐    ┌──────────┐    ┌──────────────┐              │
│   │  Local   │    │  Sync    │    │   SQLite     │              │
│   │  API     ├────┤  Cache   ├────┤  (per shop)  │              │
│   └────┬─────┘    └──────────┘    └──────────────┘              │
│        │   LAN WebSocket (real-time, 1-3 counters)              │
│   ┌────┴───────────────────────────────────────────┐            │
│   │                                                │            │
│ ┌─┴────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┴┐           │
│ │Counter 1 │ │Counter 2 │ │Counter 3 │ │  Owner    │           │
│ │ (browser)│ │ (browser)│ │ (browser)│ │ (browser) │           │
│ └──────────┘ └──────────┘ └──────────┘ └───────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Stack recommendation

**Frontend (already decided)**
- React 18 + TypeScript
- shadcn/ui + Tailwind (default zinc theme)
- TanStack Table for data grids
- TanStack Query for server state
- Zustand for client state
- react-hook-form + zod for forms
- Recharts (via shadcn Charts) for visualizations
- react-hotkeys-hook for shortcuts
- date-fns, dinero.js, Intl.NumberFormat (en-IN) for India-specific formatting

**Backend (recommendation)**
- **NestJS + TypeScript** — opinionated, modular, plays well with LLM-assisted dev. Alternative: Hono if we want lighter weight.
- **Postgres** managed (Supabase or Neon) — broad tooling, ElectricSQL/PowerSync compatible
- **ElectricSQL** for offline-first sync — local SQLite mirror of relevant Postgres subset, automatic bidirectional sync. Alternative: PowerSync (commercial, more polished).
- **Yjs over self-hosted WebSocket** for real-time collaborative state within a shop — presence, parked bills, activity feed. Self-hosted via `y-websocket` on Node, backed by Redis pub-sub for multi-instance scale. Saves ~₹50/shop/month vs commercial Liveblocks; costs ~3–4 weeks engineering up-front. See §6.6.
- **BullMQ on Redis** for async jobs (PDF generation, exports, integration calls)
- **S3-compatible object storage** for PDFs, exports, image assets

**Shop-local server**
- Same Node.js codebase running in a small Docker container on shop's counter PC or a dedicated mini-PC
- Local SQLite mirror; one local WebSocket server for LAN real-time
- Bidirectional sync to cloud via ElectricSQL

**Infrastructure**
- Hosting: AWS Mumbai or DigitalOcean Bangalore (data residency)
- CDN: Cloudflare
- Monitoring: Sentry + Better Stack (uptime) + PostHog (product analytics)
- CI/CD: GitHub Actions → containerized deploys

### 6.3 Why this stack

- **ElectricSQL / PowerSync** is the only practical way a solo founder ships true offline-first multi-user in 9 months. Hand-rolling sync is a 12-month project on its own.
- **Yjs (self-hosted)** for real-time is well-trodden — Linear, Notion, and Figma use the same pattern. LLM coverage is good. Self-hosting trades engineering time for unit economics; at ₹499 ARPU, the right trade.
- **NestJS** because solo dev + contractors benefits from opinionated structure; new engineers onboard fast.
- **Postgres** because it's the most boring choice that works for everything we need including reporting.

### 6.4 Data model (sketch)

Out of scope for full schema in v0.1; minimum entities to align stakeholders on:

`Org` → `Shop[]` → `Counter[]`, `Bill[]`, `GRN[]`, `Inventory[]`, `Customer[]`, `Supplier[]`, `User[]`
`Item` (master, org-level) ← `ItemPrice` (shop-level overrides)
`Item` → `Batch[]` (per shop)
`Bill` → `BillLine[]` → references `Batch`
`PricingRule` (customer-scoped, with scope discriminator)
`LedgerEntry` (per customer or per supplier, double-entry)
`Payment` → allocates against `Bill[]` or `GRN[]`
`AuditEntry` (append-only)

### 6.5 Drug master DB sourcing (open-source path)

Founder decision (v0.2): bootstrap the master DB from open sources rather than license commercial. Achievable but with realistic caveats.

#### What we can source for free

- **CDSCO Drug Approval Database** — public via cdsco.gov.in. Provides approved brand names, manufacturers, formulation, and approval dates. ~20,000+ approved drugs in India.
- **National List of Essential Medicines (NLEM)** — public; ~400 essential drugs with composition.
- **Generic name / salt / molecule data** — multiple public sources including NLEM, WHO INN database, CDSCO.
- **HSN codes** — GSTN publishes the official HSN list with applicable rates. Pharma falls under chapter 30; surgicals chapter 90.
- **Drug Schedule classifications** — Drugs & Cosmetics Act, public. Schedule H, H1, X are clearly defined.
- **Common ayurveda items** — government's AYUSH formularies are public.
- **Common surgicals** — no central registry; sourced from public B2B distributor catalogs and IS standards.

#### What we cannot source for free

- **Current MRP per SKU** — changes weekly; commercial DBs (PharmaTrac, IMS) make their living on this. Not in CDSCO data.
- **PTR / PTS** — distributor-side rates, regional, proprietary.
- **Pack-format and barcode mappings** — partial coverage in public databases; gaps in long-tail SKUs.
- **Substitute / molecule-equivalence mappings** — public salt data exists; the pharmacist judgment of which brand substitutes for which is encoded in commercial DBs.

#### Strategy

1. **Phase 1 (month 1–2):** Ingest CDSCO, NLEM, AYUSH, HSN, Schedule data into a structured catalog. ~20k–25k SKUs with identity fields. Expect 80–90% coverage of items a typical shop sells.
2. **Phase 1 (month 2–3):** Manual curation pass on top 1,000 highest-velocity SKUs (paracetamols, antibiotics, common chronic care) — fill in pack formats, common barcodes. ~₹50k–1L of contractor time.
3. **Phase 2 onwards:** **Crowd-sourced refinement.** Every customer GRN refines the master:
   - MRP at receipt → median observed MRP per SKU
   - Pack format → resolves long-tail gaps
   - Barcodes → builds barcode map organically
   - This is genuinely a network-effects moat. Marg has none of this because their data is per-shop, not shared.
4. **Phase 3 (post-launch, if needed):** If gaps persist at 500+ customers, consider commercial DB licensing (₹5–10L budget) — by then we'll know which gaps actually matter.

#### Legal note
CDSCO and NLEM data is government-published, free to use. AYUSH data similar. HSN data from GSTN is public. **Do not scrape PharmEasy, 1mg, Tata1mg, or similar commercial catalogs** — even if technically reachable, this creates legal risk for a bootstrapped company. Use only sources with clear public-use licenses.

### 6.6 Self-hosted real-time sync (Yjs deployment)

Founder decision (v0.3): self-host Yjs rather than use commercial Liveblocks. Detail of what this actually requires.

#### Deployment architecture

```
                    Cloud (real-time tier)
   ┌────────────────────────────────────────────────────┐
   │  ALB (sticky sessions by shop_id)                  │
   │              │                                     │
   │   ┌──────────┴──────────┐                          │
   │   │                     │                          │
   │  y-ws node 1        y-ws node 2  ... (autoscale)   │
   │   │                     │                          │
   │   └──────────┬──────────┘                          │
   │              │                                     │
   │       Redis (pub-sub for cross-instance fanout)    │
   │              │                                     │
   │       Postgres (Y-doc snapshots, every N ops)      │
   └────────────────────────────────────────────────────┘

                    Shop LAN (real-time tier)
   ┌────────────────────────────────────────────────────┐
   │     y-ws node on shop server (single instance)     │
   │       │                                            │
   │       SQLite (Y-doc persistence)                   │
   │       │                                            │
   │   Counter browsers (1–4 per shop)                  │
   └────────────────────────────────────────────────────┘
```

#### What we use Yjs for (and what we don't)

**Use Yjs for:** ephemeral collaborative state where last-write-wins or CRDT semantics are correct
- Presence (who's at which counter)
- Parked bills (in-progress carts being edited)
- Activity feed (append-only stream)
- Internal notes attached to bills/customers
- "Being edited" indicators on master records

**Do NOT use Yjs for:** anything financial or anything that needs strict atomicity
- Bill commits (use Postgres transactions via ElectricSQL)
- Stock decrements (atomic Postgres ops; Yjs would let two counters over-commit)
- Payments, ledger entries, audit log
- Master DB updates

This separation is the most important design decision in the entire sync layer. Yjs is for *coordination*; Postgres + ElectricSQL is for *truth*. Confusing them leads to data loss.

#### Engineering deliverables (Phase 1)

- `y-websocket` server in Node, deployable as a container
- Redis pub-sub adapter for multi-instance fanout
- ALB or HAProxy with sticky sessions by shop_id (Yjs rooms partition by shop)
- Periodic Y-doc snapshot to Postgres (every 100 ops or 60 seconds, whichever first)
- Recovery: on client reconnect, server replays from snapshot + any newer ops
- Monitoring: socket count per shop, message rate, snapshot lag, drop rate
- Same binary runs on cloud and on shop local server (single-instance mode locally)

#### Cost & risk

- **Cost saved:** ~₹50/shop/month at scale vs Liveblocks → at 1,000 shops, ~₹6L/year saved
- **Cost incurred:** ~3–4 weeks of senior engineering up front; ~10% of one engineer's ongoing time for operational tuning in year 1
- **Risk:** sync bugs in Phase 1 stall the launch. Mitigation: spike a working prototype in week 1 of Phase 1 before committing to schema or UI; reach for commercial Liveblocks only if the spike reveals unexpected issues.

---

## 7. Sequencing & milestones

A solo founder + contractors over 9–12 months cannot work on everything in parallel. This is the proposed sequencing. Months are notional.

### Phase 1: Foundation (months 1–3)

- **Week 1 spike: Yjs self-host POC.** Prove the architecture before committing. If unexpected blockers, fall back to Liveblocks before further investment.
- Architecture setup: cloud + local server skeleton, ElectricSQL sync working end-to-end
- Self-hosted Yjs deployment (y-websocket + Redis + Postgres snapshotting) — see §6.6
- Auth, users, orgs, shops, role system
- Item master (CDSCO/NLEM/AYUSH ingestion pipeline → ~20–25k SKUs)
- Customer master, supplier master
- Basic billing screen (single counter, no real-time yet)
- Basic GRN screen
- Daily sales report (simplest end-to-end loop)

**Exit criteria:** Internal demo of "create shop → import items → bill a customer → see daily sales" in single-counter mode. Yjs sync infrastructure ready but not yet wired to UI features.

### Phase 2: Multi-user & inventory health (months 4–6)

- Real-time sync via Yjs (presence, live stock, parked bills)
- Multi-counter billing with conflict resolution
- Inventory health dashboards (near-expiry, low stock, dead stock)
- Customer pricing rules (full UI + rule engine)
- Schedule H/H1 capture
- Payment splits, credit ledger, basic receivables/payables
- Print: thermal + A4

**Exit criteria:** Pilot-ready. 5–10 shops onboarded for white-glove pilot. Counter staff complete shifts on the product without breaking.

### Phase 3: Tax + integrations + scale (months 7–9)

- GSTR-1, GSTR-3B, GSTR-2A generation + GSTN API filing
- Tally export
- WhatsApp Business (bill sharing, reminders)
- Payment gateway integration (Razorpay)
- Self-serve onboarding: Excel imports, setup wizard, Marg/Tally templates
- Dot-matrix print support
- Reports library (the ~30)
- Bank reconciliation (manual import flow)

**Exit criteria:** Self-serve customer can sign up, import data, and run a real shop within 30 minutes. Public beta opens.

### Phase 4: Polish & broad launch (months 10–12)

- Performance: cold start, search latency, large dataset rendering
- Distributor APIs (top 2–3)
- Mobile-responsive owner dashboard
- Hindi localization
- Accessibility audit
- Compliance audit (legal review of GST + DCA compliance)
- Pricing page, billing system, support knowledge base

**Exit criteria:** Public launch, paid signups, 1,000+ shops within 90 days of GA.

### Risks to this plan

- **Sync layer instability.** If ElectricSQL/PowerSync has unexpected limits or bugs at our scale, sync becomes a 3-month detour. Mitigation: small POC in week 1; choose between Electric and PowerSync based on it.
- **Pre-seeded DB licensing.** National drug DBs exist but most are proprietary. Mitigation: bootstrap from public CDSCO data + scraping with caution; license commercial DB if needed (₹5–10L budget).
- **GSTN API access.** Requires becoming a registered GSP or partnering with one. Mitigation: partner with an existing GSP (ClearTax, IRIS) initially; pursue direct integration in v2.
- **Solo founder bottleneck.** Many decisions in parallel will stall things. Mitigation: hire 1–2 contractors for non-blocking work (frontend polish, integrations) by month 3.

---

## 8. Go-to-market

### 8.1 Positioning

> "The first ERP built for how your shop actually works in 2026."

Positioning *against* Marg directly, not generic ERP. Specific contrast points:
- **Multi-user real-time** vs Marg's bolted-on file share
- **Modern UI** that's faster to learn vs Marg's keyboard maze
- **Cloud + offline** vs Marg's local-only Windows install
- **GST built-in** vs Marg's reports-then-export-then-clean-then-file
- **One subscription** vs Marg's per-module pricing

### 8.2 Pricing

**Locked decision (founder, v0.2):** **₹499/month flat, all features, first month free, no signup costs.** Annual plan optional with discount.

#### Concern flagged for revisit

The ₹499 price point is aggressive and worth re-evaluating after the first 50–100 paid customers. Specific concerns:

1. **Marg's effective monthly cost** (₹15–25k one-time amortized over 3 years + AMC) is roughly ₹600–900/month equivalent. We are pricing *below* the displaced competitor, which is unusual when our product is meaningfully better.
2. **Multi-shop chains** (10 shops × ₹499 = ₹4,990/month) get massive value for a tiny price. The Chain segment can support 2–3× the per-shop ARPU without resistance.
3. **Unit economics for a bootstrapped solo founder** are sensitive at this price. Per-shop monthly costs (cloud infra, Razorpay fees, WhatsApp messaging, GSP filing, monitoring) realistically run ₹150–250 in year 1. That's a ~50% gross margin — workable but doesn't leave much for hiring.
4. **Hard to raise prices later** without churn. Easier to launch higher and discount than launch low and raise.

#### Triggers to revisit pricing
- After 100 paying customers: review CAC, churn, support load. If healthy, hold. If margin-squeezed, raise to ₹749 with grandfathering.
- Chain segment specifically: introduce a separate "Chain" tier at ₹999/month/shop if multi-shop customers don't push back. This can ship as early as v1.1.

#### What the ₹499 plan includes
- Single shop, unlimited users
- All features (no feature-gated tiers in v1)
- Counter billing, purchase, inventory, payments, tax, customers
- All six integrations (GSTN, Razorpay, WhatsApp, Tally export, distributor APIs, AA when ready)
- Email + chat support, business hours

#### Add-ons
- White-glove migration: ₹2,500–5,000 one-time (founder's call), free for first 50 strategic accounts
- Priority support (4-hour SLA): ₹499/month — defer to v1.1
- Chain plan (>3 shops): pricing TBD, target ₹999/month/shop

### 8.3 Channels

- **Direct online:** SEO-heavy content marketing, paid Google Ads on "Marg alternative" type keywords
- **WhatsApp Business presence:** demo videos, customer support
- **Partner network:** distributors who sell software + hardware to chemists are an obvious channel; cultivate 5–10 partners
- **Referral program:** existing customer refers, both get a month free
- **CA channel:** CAs are gatekeepers for software choice in many shops; cultivate

### 8.4 Customer success

At 1,000 customers, we cannot offer phone support to all. Tiered support:
- **All tiers:** Chat (in-product) and email, business hours
- **Growth+:** Priority queue, response within 4 hours
- **Chain:** Dedicated account manager (shared across ~50 chains)
- **Knowledge base:** comprehensive, video-heavy, multi-language
- **Power user community:** Discord or WhatsApp group for super-users

---

## 9. Metrics & success criteria

### 9.1 Leading indicators (tracked weekly)

- Signups (raw)
- Activation rate (signed up → completed onboarding → first bill within 7 days)
- Time-to-first-bill (median)
- Bills per active shop per day
- DAU/MAU ratio (target >0.6 for the owner role, >0.9 for cashier role)
- Search-to-bill conversion (cashier search → item added; should be >85%)

### 9.2 Lagging indicators (tracked monthly)

- MRR, ARR
- Paid customers (shops)
- Churn rate (target <3% monthly for first 12 months)
- NPS (target ≥40 at 3 months on platform)
- Support tickets per customer per month (target <0.5)
- % of customers who completed migration from Marg/Tally (target >80%)

### 9.3 Operational health

- Uptime (target 99.9%)
- Sync conflict rate (target <0.1% of writes)
- Time-to-resolve P0 incidents (target <2 hours)
- Data loss incidents (target zero)

---

## 10. Open questions remaining

Status of decisions through v0.3:

### Resolved (v0.2)

- ✅ **Q1.** Drug DB → **Open source** (CDSCO + NLEM + AYUSH + crowd-sourced refinement). See §6.5.
- ✅ **Q2.** GSP partner → **ClearTax free tier** first 100 customers, paid GSP (IRIS likely) at scale.
- ✅ **Q3.** Local-server hardware → **Customer-provided** with certified compatibility list.
- ✅ **Q4.** Payment gateway → **Razorpay** in v1.
- ✅ **Q5.** Pricing → **₹499/month flat, first month free, no signup cost.** Concern noted; revisit trigger at 100 customers (see §8.2).
- ✅ **Q7.** Legal entity → **New India Pvt Ltd** to be incorporated before first paid customer.
- ✅ **Q8.** Funding posture → **Bootstrapped**. Shapes all other decisions.
- ✅ **Q9.** Pilot shops → **Founder has access** to design partner shops for Phase 2.
- ✅ **Q10.** Compliance counsel → **CA arrangement secured**. Engage for regulatory review pre-launch.

### Resolved (v0.3)

- ✅ **Q6.** Product name → **Salt**. Vocabulary the customer already uses ("iska salt kya hai?"); clean trademark landscape in Indian pharmacy software; cross-vertical fit. Domain strategy: lock `salt.in` as primary; defensive registrations of `getsalt.com`, `usesalt.com`, `salt.app`, `saltpos.com`. Trademark application in Class 9 (software) and Class 35 (retail services) before any public mention.
- ✅ **Q11.** Real-time sync hosting → **Self-host Yjs over WebSocket.** Implications:
  - Saves ~₹50/shop/month vs commercial Liveblocks at the cost of ~3–4 weeks engineering for production-grade Y-WebSocket deployment
  - Need: Redis for pub-sub, sticky session load balancing, conflict-replay recovery, monitoring of socket health
  - At ₹499 ARPU, this is the right call — Liveblocks fees would have eaten ~10% of gross margin
  - Phase 1 must include this as a real architecture deliverable, not deferred
- ✅ **Q12.** Marked not relevant — founder will manage contractor hiring directly.
- ✅ **Q13.** WhatsApp Business cost control → **Yes, capped messaging strategy.** Only opted-in bill sharing and owner-initiated reminders. No auto-everything. Expected cost: <₹30/shop/month at scale.
- ✅ **Q14.** GST e-invoicing threshold → **Confirmed acceptable.** Threshold currently ₹5 crore aggregate turnover; target customers (small/mid pharma retailers) overwhelmingly below this. Build e-invoicing as optional v1.1 feature for the small fraction of chains that cross threshold.
- ✅ **Q15.** Crowd-sourced data legal posture → **CA to advise pre-launch.** Will design data anonymization carefully (no shop-identifying info, no customer info, aggregated medians only) and get formal sign-off before activating the feature.

### No open questions remain at this time.

New questions will likely emerge during Phase 1 implementation (architecture detail, schema decisions, specific integration mechanics). Track those in a separate engineering decisions log, not in this PRD.

---

## 11. Appendix — Reference documents

To be added as separate documents (not in this PRD):

- **Design system spec** — shadcn customization, density rules, typography
- **Data model schema** — full ERD
- **API contract** — REST + WebSocket endpoints
- **Sync protocol spec** — ElectricSQL config, conflict resolution rules
- **Print template specs** — thermal/A4/dot-matrix layouts per bill type
- **Integration specs** — one document per integration (GSTN, WhatsApp, Razorpay, Tally, distributors, AA)
- **Onboarding playbook** — Marg → Salt step-by-step, Tally → Salt step-by-step
- **Compliance checklist** — DCA + GST + data residency

---

*End of PRD v0.1. Next steps: founder review, identify the 5–10 highest-stakes Open Questions to resolve, then break Phase 1 into engineering tickets.*
