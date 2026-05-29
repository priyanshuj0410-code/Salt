---
type: product
updated: 2026-05-29
tags: [market, competition, compliance, india]
---

# Market research — Indian pharma retail ERP

Synthesis of competitive landscape, regulatory requirements, pain points, and modern trends. Use this alongside [product/prd](prd.md) to make build-vs-skip calls.

## 1. Major players

### Feature matrix

| Feature | Marg ERP 9+ | GoFrugal | RetailGraph (SwilERP) | eVitalRx | Tally + TDL | Salt (current) |
|---|---|---|---|---|---|---|
| Batch-wise billing + FEFO | ✅ | ✅ | ✅ | ✅ | TDL add-on | ✅ (no persist yet) |
| Schedule H1 register + sale block | ✅ | ✅ best-in-class | ✅ | — | TDL add-on | ⬜ |
| GST MRP-inclusive handling | ✅ | ✅ | ✅ | ✅ | native | ✅ (back-calc) |
| GSTR-1/3B export | ✅ | ✅ | ✅ | ✅ | native | ⬜ |
| GSTR-2B reconciliation | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Purchase / GRN | ✅ | ✅ | ✅ | ✅ | native | ⬜ |
| Near-expiry alerts | ✅ | ✅ (6m/3m advance) | ✅ | ✅ | TDL | ⬜ |
| Expiry return workflow | ✅ partial | ✅ | ✅ | partial | manual | ⬜ |
| ITC reversal on expired stock | ⬜ | ⬜ | ⬜ | ⬜ | manual | ⬜ |
| Drug master (pre-filled) | ✅ | ✅ 50k+ drugs | ✅ | ✅ 4 lakh+ | ⬜ | ⬜ |
| Offline billing | ✅ desktop | ✅ hybrid | ✅ on-prem | ⬜ | ✅ desktop | ⬜ |
| Offline-first + cloud sync | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Modern UI | ⬜ | 🟡 | 🟡 | ✅ | ⬜ | ✅ |
| WhatsApp invoice sharing | ✅ newer | ✅ | SMS only | ✅ | ⬜ | ⬜ |
| Purchase invoice OCR / AI | ✅ | ⬜ | ⬜ | Sahaai AI | ⬜ | ⬜ |
| Multi-store / chain | limited | ✅ strong | ✅ strong | ✅ | ⬜ | ⬜ |
| ABHA / ABDM integration | ✅ | ⬜ | ⬜ | ✅ NHA-approved | ⬜ | ⬜ |
| ONDC integration | planned | ⬜ | ⬜ | ✅ first | ⬜ | ⬜ |
| B2B distributor ordering | ERP-to-ERP | purchase orders | Pharmarack/iOrder | eVitalSupply | ⬜ | ⬜ |
| Drug license renewal alerts | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Pricing (approx. annual) | ₹5k–₹25k | ₹18k–₹85k | ₹20k+ | ₹7k–₹50k | ₹18k–₹27k + TDL | ₹6k target |

**Key read**: GSTR-2B reconciliation and ITC reversal automation are gaps across every major competitor. Offline-first with cloud sync is a gap in every cloud tool. Drug license alerts are missing everywhere.

### Player profiles

**Marg ERP 9+** — dominant in independent chemists (1.75 lakh+ installs). Desktop-only; single-machine single-user. Old UI universally criticised. AMC (₹5,500+/yr) increasingly seen as support fee without support. MargBooks is a separate, shallower cloud product — the two do not share data cleanly. Lock-in via proprietary DBF format. AI OCR for purchase invoice import is a genuine differentiator.

**GoFrugal** — strongest on Schedule H1 compliance (literally blocks the sale if required register fields are not filled). Best chain/multi-store feature set. Hybrid: cloud POS + optional on-premise ERP. 50k+ drug prefill database. More expensive (₹18k–₹85k/yr).

**RetailGraph / SwilERP** — 30k+ installs, strong chain focus, integrates with Pharmarack/iOrder B2B ordering. On-premise first. Feature-rich but UI is dated.

**eVitalRx** — cloud-native, modern UI, ABDM/ABHA-compliant, first on ONDC, 4 lakh+ drug database with salt contents. Fatal gap: **no offline mode** — any internet outage halts billing.

**Tally + TDL** — Tally is native accounting (India's most-used accounting tool) but pharma-specific features (batch tracking, H1 register, drug master) require paid third-party TDL add-ons that frequently conflict with each other and with core Tally updates.

---

## 2. GST compliance — pharma specifics

### GST rates on medicines (post Sept 2025 rationalisation)

| Rate | What it covers |
|---|---|
| Nil / Exempt | Blood products, specific vaccines, 36 critical life-saving drugs (updated list) |
| 5% | Most essential medicines (National List of Essential Medicines); expanded from 12% in 2025 rationalisation |
| 12% | Ayurvedic/Unani/Siddha preparations, diagnostic kits, medical devices |
| 18% | Non-essential supplements, cosmeceuticals, certain imports |

### MRP-inclusive billing rule

MRP printed on a strip is **GST-inclusive**. A pharmacy cannot charge GST on top of MRP at the counter. The billing software must **back-calculate** GST from MRP (`taxable = mrp / (1 + rate/100)`). PTR and PTS from distributors are **GST-exclusive** — GST is added on top when making the purchase entry. Software must handle both directions correctly. Per [decisions/0003-money-as-paise.md](../decisions/0003-money-as-paise.md), Salt stores MRP in paise and uses `splitInclusiveGst` — this is correct.

### Mandatory invoice fields (Rule 46 CGST + D&C Rules)

Tax invoice for a pharmacy must contain: supplier GSTIN, unique invoice number, date, buyer GSTIN (B2B > ₹50k), HSN code (4-digit < ₹5 Cr turnover; 6-digit above), **batch number**, **expiry date**, **drug license number** of selling chemist, taxable value, GST rate, CGST/SGST or IGST amount. The batch number and expiry date fields on printed invoices are a D&C Rules requirement, not just GST.

### GST returns

| Return | Frequency | Key pharma risk |
|---|---|---|
| GSTR-1 | Monthly (or quarterly QRMP) | HSN summary mandatory; mismatch with distributor's GSTR-1 is common |
| GSTR-3B | Monthly | ITC reversal for expired/destroyed stock must be reported here |
| GSTR-2B | Auto-populated monthly | Distributor late filing or wrong HSN → ITC mismatch; no tool auto-reconciles this |
| GSTR-9 | Annual | GSTR-9C audit required above ₹5 Cr |

### E-invoicing thresholds

- AATO > ₹5 Cr → mandatory e-invoicing (all B2B invoices must be registered on IRP before delivery)
- AATO > ₹10 Cr → 30-day upload deadline (from April 2025; invoices uploaded later than 30 days are rejected by IRP)
- B2C counter sales → e-invoicing not required
- Most standalone pharmacies are below ₹5 Cr; pharmacy chains and wholesale arms will cross it

### ITC reversal on expired stock

Per Section 17(5)(h) CGST Act: if medicines expire and are **physically destroyed**, ITC must be reversed in the month of destruction (not the expiry month). If returned to supplier via credit note, no separate reversal needed. No ERP in India auto-calculates the reversal amount from batch-level ITC. This is both a compliance risk and an opportunity.

---

## 3. Schedule H / H1 / X — legal requirements

### What each schedule means

| Schedule | Drugs covered | Sale requirement |
|---|---|---|
| H | ~510 drugs (antibiotics, hormones, cardiovascular) | Must be sold on RMP prescription; Rx label required |
| H1 | ~46 drugs (3rd/4th-gen antibiotics, anti-TB, habit-forming) | Separate physical/digital register mandatory; retained 3 years |
| X | Narcotic & psychotropic (morphine, codeine, diazepam…) | Special Form 20F license; kept under lock and key; cannot be sold online |

NDPS Act drugs (separate from D&C Schedule X): require NDPS license from State Excise (not Drug Controller); Form 6 narcotic register; inspected by both Drug Controller and Excise. Software must distinguish D&C Schedule X from NDPS Act drugs.

### Schedule H1 register: mandatory fields (Gazette GSR 588(E), 30-Aug-2013)

At the time of supply, the register must record:
1. Serial number
2. Date of supply
3. Name and address of prescribing doctor
4. Name and address of patient
5. Name of drug / preparation
6. Quantity supplied
7. Manufacturer name, batch number, expiry date
8. Signature of Registered Pharmacist

Retained for **3 years**, open to inspection.

### Schedule H (non-H1) — bill must record

Date, patient name & address, prescriber name & address, drug name & quantity, batch number, expiry date. Retained **2 years**.

### Software implications for Salt

- Flag each item's schedule at billing (H / H1 / X / OTC) — items.schedule column already exists
- For H1: **block completion of sale** until all register fields are entered; not a soft warning
- Auto-generate the H1 register as a dated, printable PDF for drug inspector visits
- For X: block sale if special license flag is not set on the org; never allow delivery/online mode
- Prescription image upload + retention
- Audit trail: pharmacist who completed the sale, timestamp

GoFrugal is the benchmark here — it is the only major tool that enforces H1 at the flow level rather than relying on the user to remember.

---

## 4. Industry pain points

### Marg ERP — top complaints (Capterra/G2/SoftwareSuggest, 2024–2025)

1. **Single machine, single user**: one counter can bill at a time; peak hours are painful
2. **Outdated UI**: Windows XP-era, universally criticised
3. **Support quality decay**: AMC fees increased to ₹5,500+/yr; support unresponsive for weeks or months
4. **Dealer dependency**: sold through local dealers; when dealer folds, customer is stranded
5. **No real cloud**: MargBooks is cloud but feature-shallow; Marg 9+ and MargBooks are not unified
6. **Forced disruptive upgrades**: automatic updates slow machines and break workflows
7. **No customisation**: bill format, label layout changes cost extra
8. **English-only**: difficult for non-English-speaking staff in tier-2/3 towns
9. **Data lock-in**: DBF format; migration to any other tool requires the Go migrator approach

### Tally + TDL — specific limitations

- Not pharmacy-native; all pharma features require paid third-party TDL modules
- TDL conflicts: pharma TDLs frequently break each other or break on core Tally updates
- No POS speed: not designed for fast barcode-driven counter billing
- No drug master; every item must be created manually
- Accounting-first mental model confuses pharmacy counter staff

### Broader ecosystem pain points

**Internet reliability**: Cloud-only tools are useless during outages — common in tier-2/3 cities on mobile data. "Internet-dependent pharmacy software creates serious business risks including lost sales, data loss, compliance issues." This is the most-cited structural risk in 2025 reviews.

**Pricing complexity**: Indian pharma has 4 price layers (MRP, PTR, PTS, purchase rate) plus 2 GST rates, scheme discounts (10+1 free goods), cash discount, trade discount. Most tools handle the common cases; edge cases (expiry returns at original purchase price, scheme reversal on partial return) are manual.

**GST-2B reconciliation**: Monthly reconciliation against distributor filings is manual everywhere. A mid-size pharmacy has 15–40 distributors; if any file late or use the wrong HSN, the pharmacy's ITC is at risk. No tool automates this.

**Multi-SKU burden**: A mid-size pharmacy stocks 3,000–8,000 SKUs; a large outlet 15,000+. Mixed-category (pharma + surgical + FMCG + ayurvedic) is the norm but most ERPs are pure-pharma oriented.

**Marg data migration**: Proprietary DBF format creates lock-in. Our Go migrator is a genuine answer to this — but most chemists don't know migration is possible.

**Scheme management**: Distributor schemes (expiring, compound, product-specific) are communicated informally and manually entered. No ERP pulls scheme data electronically.

**Inspector readiness**: Drug inspectors visit with 24–48 hours notice. Chemists need: H1 register, drug license, batch-wise purchase invoices for last 12 months, expiry stock report. Most tools generate some of this; none generate all in inspector-ready format.

---

## 5. Modern trends

### Offline-first with cloud sync

The market is split: desktop-offline (Marg, Tally, RetailGraph) vs. cloud-only (eVitalRx). No major player does offline-first + cloud sync. This is the biggest infrastructure gap and directly aligns with Salt's PRD wedge. The winning pattern is local SQLite/IndexedDB for uninterrupted billing, sync when online.

### AI applications

- **Purchase invoice OCR** (Marg does this): chemists receive 20–100 paper/PDF invoices daily from distributors. Auto-extracting item, batch, qty, MRP, PTR, GST from a photo or forwarded WhatsApp PDF is the single highest-value AI application for Indian pharma retail.
- **Demand forecasting / auto-replenishment** (GoFrugal, eVitalRx Sahaai): based on historical sales + seasonality + disease patterns. Reduces stockouts and overstocking.
- **B2B ordering suggestions**: proactively surface reorder points before the chemist notices.

### WhatsApp integration

WhatsApp is dominant in India (500M+ users). Sending invoices, account statements, payment reminders, prescription refill reminders via WhatsApp is now table stakes. eVitalRx, Marg (newer), GoFrugal all support it. Vyapar's WhatsApp feature is reportedly broken (bills sent as blank files).

### ABHA / ABDM integration

India has 74 crore+ ABHA health IDs (May 2025). Pharmacies that link dispensing records to ABHA IDs gain referral traffic from hospitals and clinics in the ABDM network. Marg and eVitalRx both support ABHA ID generation and bill linkage. NHA-approved status (eVitalRx has it) is a trust signal for large hospital pharmacy contracts.

### ONDC

eVitalRx is the first pharma ERP on ONDC — a standalone pharmacy can list medicines and fulfill online orders via ONDC without building their own app, competing with PharmEasy/Apollo without paying 20–30% marketplace commission.

### B2B distributor portals

Marg offers ERP-to-ERP ordering: pharmacy sees distributor stock, live prices, and schemes inside the billing software and places purchase orders electronically. RetailGraph integrates with Pharmarack and iOrder. This eliminates the daily phone-call/WhatsApp order cycle with distributors.

### Drug master databases

| Vendor | Size | Notable |
|---|---|---|
| eVitalRx | 4 lakh+ | Salt contents, generic equivalents, images |
| GoFrugal | 50k+ | HSN, GST rates, pack sizes pre-filled |
| Marg | proprietary | Tied to Marg updates |

A crowdsourced GRN-based approach (per the PRD) is more defensible long-term: the MRP/PTR data crowd-sourced from actual GRN entries will be more accurate than any static database.

---

## 6. Regulatory compliance beyond GST

**Drug license**: Form 20 (retail) and Form 20F (Schedule X). Renewed every 5 years. A lapsed license is a criminal offence. No major ERP sends renewal alerts. Trivial to build; missing everywhere; resonates immediately in demos.

**CDSCO / DDRS**: Central Drugs Standard Control Organisation has an RFP out for a Digital Drugs Regulatory System (DDRS). When live, pharmacies may need API integration to report H1 and X transactions to CDSCO. Software must be ready to adapt.

**Cold chain**: Insulin, vaccines, certain oncology drugs require 2°C–8°C storage with temperature log. No mainstream Indian pharma ERP offers IoT temperature monitoring integration. Future opportunity.

**AYUSH specifics**: Ayurvedic products regulated under Schedule E1; different HSN codes; no Rx/batch requirement for most OTC ayurvedic items; many at GST 12%. Dual-licensed stores (retail + AYUSH permit) are common. The items schema needs a `category` or `type` field (allopathic / ayurvedic / surgical / FMCG).

---

## 7. Competitive gaps Salt can fill

Ranked by market impact and feasibility:

| Gap | Opportunity | Difficulty |
|---|---|---|
| Offline-first + cloud sync | Removes the #1 cloud ERP fear; structural differentiator | High (needs sync substrate) |
| Modern UI + keyboard-first POS | Marg's weakest point; already done by Salt | Done |
| Schedule H1 as a hard flow gate | GoFrugal does it; others don't enforce | Medium |
| GSTR-2B auto-reconciliation | Gap across every competitor; statutory need | High |
| ITC reversal automation on expired stock | Gap everywhere; audit risk for pharmacies | Medium |
| WhatsApp invoice sharing | Table stakes; missing from current Salt | Low |
| Drug license renewal alerts | Missing everywhere; strong demo moment | Low |
| Purchase invoice OCR / AI auto-fill | Marg does it; huge daily time-saver | High |
| Inspector-ready H1 register PDF export | Easy once H1 gate is built | Low |
| Flat-rate multi-store pricing | GoFrugal charges per-store; Salt can undercut | Medium (needs multi-store schema) |
| ABHA / ABDM integration | Differentiator for hospital-adjacent pharmacies | Medium |
| ONDC listing | First-mover advantage for independents | Medium |
| Drug master database | eVitalRx has 4 lakh+; Salt has none | Medium (crowdsourced GRN approach) |

## Related
[product/prd](prd.md) · [product/roadmap](roadmap.md) · [domain/medical-retail](../domain/medical-retail.md) · [architecture/import-pipeline](../architecture/import-pipeline.md)
