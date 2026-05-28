# Product Requirements Document
## Salt Migrator — ODBC-based migration tool for Marg ERP

**Status:** Draft v0.1
**Author:** Founder (drafted with Claude)
**Last updated:** 28 May 2026
**Parent product:** Salt (medical retail ERP)
**Relationship:** Companion utility; not a standalone product

> **Assumption warning.** This PRD is written before we have confirmed Marg's actual database schema. Sections marked **[ASSUMPTION]** must be validated against 2–3 real Marg installations (ideally the pilot shops) during the Week-1 spike before engineering commits. The architecture is sound regardless; the table/column specifics are educated guesses until verified.

---

## 1. Why this tool exists

### 1.1 The problem it solves

Migration is the single biggest barrier to customers switching from Marg to Salt. The friction has three sources:

1. Marg's native export files (`.mbk`, `.arj` "Product Export") are **encrypted** — empirically confirmed by entropy analysis (7.996/8.0, no header, no readable strings). They cannot be read outside Marg and reverse-engineering the encryption is legally risky and technically fragile. **This path is closed.**
2. Marg's Excel exports work but require the customer to perform 5+ separate exports through fiddly DOS-era menus — high friction, high error rate.
3. Excel exports don't include everything (notably clean batch-level stock and full transaction history).

The Salt Migrator solves this by reading Marg's **live database directly via ODBC** — the same data Marg itself uses — and uploading structured data to Salt. This is legal (the customer owns and may access their own data), comprehensive (reads everything, not just what export menus expose), and low-friction (one guided run instead of five manual exports).

### 1.2 What it is

A small, signed **Windows desktop helper** the customer runs on their Marg PC (or any PC with network access to the Marg data/server). It:
- Connects to Marg's database via ODBC
- Reads masters, stock, and balances
- Maps Marg's schema to Salt's schema
- Validates and previews the data
- Uploads to the customer's Salt account over HTTPS

### 1.3 What it is NOT

- **Not a decryption tool.** It never touches `.mbk`/`.arj` encrypted files. It reads the live database the customer owns.
- **Not a continuous sync.** It's a one-time (or few-time) migration, not an ongoing Marg↔Salt bridge. (A "top-up re-run" is supported; live two-way sync is not.)
- **Not a general Marg reporting tool.** It reads only what migration needs.
- **Not cross-platform.** Windows only — Marg runs on Windows.

---

## 2. Users & context

### 2.1 Who runs it

- **Primary: Salt onboarding staff** (white-glove). For the first ~100 customers, *your team* runs the Migrator on the customer's machine via remote session. This is the dominant use in the first 6 months.
- **Secondary: the shop owner / their IT person**, self-serve, guided by the in-tool wizard, for scale beyond white-glove.

### 2.2 Where it runs

- On the **Marg server PC** (the machine holding the Marg data folder), or
- On any **Windows PC on the same LAN** that can reach the Marg data/Pervasive engine

### 2.3 Environmental realities to design for

- Marg installs are old. Windows 7/8/10/11 all in the field. **[ASSUMPTION]** target .NET or Go runtime must support down to Windows 7.
- Two database backends exist depending on Marg version:
  - **Older Marg:** FoxPro/dBASE `.DBF` files (file-based, easiest to read)
  - **Newer Marg (9+, ERP):** Pervasive PSQL / Actian Zen (server-based, needs the Btrieve/ODBC driver) **[ASSUMPTION — needs confirmation which versions use which]**
- Connectivity at the shop is flaky (per the parent PRD's offline-first premise). The tool must handle interrupted uploads gracefully.
- The customer is non-technical and nervous about "touching" their live data.

---

## 3. Goals & non-goals

### 3.1 Goals

- **G1.** Reduce migration from "5 manual exports" to "one guided run."
- **G2.** Read all migration-critical data: items, batch-level stock, customers, suppliers, opening balances.
- **G3.** Never modify Marg's data — strictly read-only access.
- **G4.** Validate and preview before any upload to Salt; nothing is committed without confirmation.
- **G5.** Work across the common Marg versions in the field (FoxPro and Pervasive backends).
- **G6.** Support white-glove use (your staff) and self-serve use (the owner) from the same tool.
- **G7.** Be safe and trustworthy enough that a nervous owner lets it run on their live system.

### 3.2 Non-goals

- **N1.** No write-back to Marg, ever. Read-only is a hard safety boundary.
- **N2.** No continuous/live sync. One-time + manual top-up only.
- **N3.** No transaction history migration in v1 — masters, stock, and opening balances only. (History stays in Marg as archive; see parent PRD's parallel-run strategy.) Revisit in v1.1 if customers demand it.
- **N4.** No decryption of `.mbk`/`.arj`. Legally and strategically out of scope.
- **N5.** No macOS/Linux build. Windows only.
- **N6.** No support for non-Marg sources in this tool (Tally migration is a separate effort via Excel).

---

## 4. The legal & trust boundary (read this before building)

This tool reads a customer's live business database. That demands an unusually high trust bar.

- **R1 (MUST).** Read-only at every layer. The ODBC connection MUST be opened read-only; no `INSERT`/`UPDATE`/`DELETE`/`CREATE` ever issued. Defense in depth: even if a query were malformed, the connection mode prevents writes.
- **R2 (MUST).** The tool only ever reads tables on an allow-list needed for migration. No fishing through the whole database.
- **R3 (MUST).** Explicit consent screen before connecting: plain-language explanation that the tool will read (not modify) their Marg data and upload specified categories to their Salt account.
- **R4 (MUST).** All data uploaded over TLS to the customer's own authenticated Salt account. No third-party destinations, ever.
- **R5 (MUST).** No data retained on the local machine after the run except an optional user-saved log. No telemetry containing business data.
- **R6 (MUST).** The tool is code-signed with an EV certificate so Windows SmartScreen doesn't flag it and the customer can verify authenticity.
- **R7 (SHOULD).** Open-source the tool (or at least make the source available) to build trust — a nervous owner (or their IT person) can verify it does only what it claims.
- **R8 (MUST).** Legal review by the CA/lawyer before release, specifically on: reading the customer's own data via ODBC, and any Marg licensing terms that might restrict third-party DB access. This is the single biggest legal question — resolve it before shipping.

> **The trust narrative matters as much as the code.** A bootstrapped startup asking to run software against a shop's live financial database will face suspicion. Read-only + signed + open-source + clear consent is what makes "yes" possible.

---

## 5. Functional requirements

### 5.1 Connection & detection

- **FR-CONN-001 (MUST):** Auto-detect Marg installation: scan common install paths, registry entries, and running Pervasive/Btrieve services. **[ASSUMPTION — paths/registry keys need confirmation]**
- **FR-CONN-002 (MUST):** Detect which backend is in use (FoxPro DBF vs Pervasive/Zen) and select the right driver/strategy.
- **FR-CONN-003 (MUST):** For DBF: locate the data folder (the customer may need to confirm/browse to it).
- **FR-CONN-004 (MUST):** For Pervasive: connect via the installed Pervasive ODBC driver; use the customer's existing engine. **[ASSUMPTION — whether Marg's Pervasive requires separate credentials]**
- **FR-CONN-005 (MUST):** Open the connection strictly read-only (R1).
- **FR-CONN-006 (MUST):** Graceful, plain-language errors: "Couldn't find Marg — please point us to your Marg folder," not a stack trace.
- **FR-CONN-007 (SHOULD):** Detect Marg version (from a version table or file) to apply the correct schema mapping.

### 5.2 Company / shop selection

- **FR-CO-001 (MUST):** Marg holds multiple "companies" (the customer's businesses). List them; let the user pick which to migrate.
- **FR-CO-002 (MUST):** Map a Marg "company" to a Salt "shop" (or to a Salt Org with multiple shops, per the customer's structure).

### 5.3 Data extraction (the core)

Each category is read, mapped, validated, previewed.

**Item master**
- **FR-EXT-001 (MUST):** Read all items: name, alt/short names, manufacturer/company, pack, HSN, GST%, schedule (H/H1/X), MRP, PTR, sale rate, barcode(s). **[ASSUMPTION — exact Marg table is likely something like `ITEM`/`PRODUCT`; columns need confirmation]**
- **FR-EXT-002 (MUST):** Match items against Salt's pre-seeded national drug DB by name + barcode + manufacturer; flag matches, near-matches, and new items. (Per parent PRD §4.3 — reduces import to quantity+price against known catalog.)

**Stock (the critical one)**
- **FR-EXT-010 (MUST):** Read batch-level stock: item, batch number, expiry, quantity on hand, MRP at receipt, purchase rate. **[ASSUMPTION — batch/stock table structure is the highest-risk unknown; pharma batch tracking schema varies]**
- **FR-EXT-011 (MUST):** Reconcile: total batch quantities should match item-level stock totals; flag discrepancies.

**Parties (customers + suppliers)**
- **FR-EXT-020 (MUST):** Read ledger/party master: name, type (customer/supplier), phone, address, GSTIN, credit limit. **[ASSUMPTION — Marg stores both as "ledgers" under account groups; the group determines customer vs supplier]**
- **FR-EXT-021 (MUST):** Classify each party as customer, supplier, or both based on Marg's account group.

**Balances**
- **FR-EXT-030 (MUST):** Read current outstanding balances per party (receivables and payables) as of migration date → Salt opening balances.
- **FR-EXT-031 (SHOULD):** Read item-wise opening stock valuation for accounting accuracy.

**Pricing rules**
- **FR-EXT-040 (SHOULD):** Read any customer-specific pricing/discount schemes Marg holds, map to Salt's pricing rule engine. **[ASSUMPTION — Marg's discount structure may not map cleanly; may defer to manual setup]**

### 5.4 Mapping & transformation

- **FR-MAP-001 (MUST):** A versioned mapping layer: Marg-schema → Salt-schema, keyed by detected Marg version. New Marg versions add a mapping profile without changing core code.
- **FR-MAP-002 (MUST):** Handle encoding: Marg DBF data is often `cp1252`/legacy encoding; convert to UTF-8 cleanly (Hindi/regional text must survive).
- **FR-MAP-003 (MUST):** Normalize: dates, currency (paise vs rupees), GST rate formats, schedule codes.
- **FR-MAP-004 (MUST):** Deduplicate against Salt catalog (FR-EXT-002) so migration doesn't create duplicate item definitions.

### 5.5 Validation & preview

- **FR-VAL-001 (MUST):** Before any upload, show a summary: "4,832 items (4,610 matched to catalog, 222 new), 1,204 parties, 8,910 stock batches, ₹X total receivables."
- **FR-VAL-002 (MUST):** List problems with severity: errors (block import) vs warnings (allow with note). E.g., "12 items missing HSN" (warning), "3 stock batches reference unknown items" (error).
- **FR-VAL-003 (MUST):** Let the user fix-in-place or skip problem rows, then re-validate.
- **FR-VAL-004 (MUST):** Nothing uploads until the user explicitly confirms the preview.

### 5.6 Upload to Salt

- **FR-UP-001 (MUST):** Authenticate to the customer's Salt account (phone+OTP or a one-time migration token generated in Salt).
- **FR-UP-002 (MUST):** Upload in resumable chunks; survive a dropped connection and continue (per flaky-connectivity reality).
- **FR-UP-003 (MUST):** Idempotent: re-running doesn't duplicate already-migrated data (match on stable keys).
- **FR-UP-004 (MUST):** Server-side validation mirrors client-side; server is the final gate.
- **FR-UP-005 (MUST):** Post-upload report: what was created, what was skipped, what needs attention in Salt.

### 5.7 Top-up re-run

- **FR-TOP-001 (SHOULD):** Support a second run that imports only items/parties created in Marg since the last run (for customers running Marg and Salt in parallel during transition). Uses Marg's "created after" date where available.

---

## 6. Non-functional requirements

- **NFR-001 (Performance):** Read + map a 5,000-item, 10,000-batch, 1,500-party dataset in under 5 minutes (excluding upload).
- **NFR-002 (Reliability):** A failed/interrupted run leaves no partial state in Salt — uploads are transactional per category.
- **NFR-003 (Safety):** Read-only enforced at connection level (R1). No code path can write to Marg.
- **NFR-004 (Compatibility):** Runs on Windows 7 through 11. Bundles its own runtime — no "install .NET first" friction. **[ASSUMPTION — confirm oldest Windows in pilot fleet]**
- **NFR-005 (Footprint):** Single signed `.exe`, ideally < 30MB, no installer required (portable). Customer downloads and runs.
- **NFR-006 (Trust):** EV code-signed; SmartScreen-clean; source available.
- **NFR-007 (Usability):** A non-technical owner can complete a guided run in under 15 minutes with no phone support.

---

## 7. Technical approach (recommendation)

### 7.1 Stack

- **Language:** Go or .NET. **Recommendation: Go** — single static binary, trivial cross-Windows-version support, small footprint, no runtime install. (.NET is viable and has better native ODBC ergonomics, but runtime versioning on old Windows is a headache.) **[Founder/eng decision]**
- **DBF reading:** direct DBF parsing library (no ODBC needed for file-based Marg) — faster and dependency-free for older installs.
- **Pervasive/Zen reading:** via the installed Pervasive ODBC driver on the customer's machine (we don't ship it; Marg already has it).
- **UI:** lightweight local web UI (the Go binary serves a localhost page) or a minimal native window (Wails/Tauri-style). Localhost-web keeps the UI consistent with Salt's design system (reuse `design.md` tokens).
- **Upload:** HTTPS to Salt's migration API; resumable chunked upload.

### 7.2 Architecture

```
Customer's Windows PC
┌──────────────────────────────────────────────┐
│  Salt Migrator (single signed .exe)           │
│                                                │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐  │
│  │ Detector │──>│ Reader   │──>│ Mapper    │  │
│  │ (find    │   │ (DBF or  │   │ (Marg→Salt│  │
│  │  Marg)   │   │  ODBC)   │   │  schema)  │  │
│  └──────────┘   └────┬─────┘   └─────┬─────┘  │
│                      │ READ-ONLY     │        │
│                 ┌────┴─────┐    ┌────┴──────┐ │
│                 │ Marg DB  │    │ Validator │ │
│                 │ (DBF/PSQL)│   │ + Preview │ │
│                 └──────────┘    └────┬──────┘ │
│                  localhost UI ───────┤        │
└──────────────────────────────────────┼────────┘
                                        │ HTTPS (resumable)
                              ┌─────────┴─────────┐
                              │  Salt Migration   │
                              │  API (cloud)      │
                              └───────────────────┘
```

### 7.3 The schema mapping problem (the real work)

The hard part is not the plumbing — it's knowing Marg's exact tables and columns, which differ by version and are sometimes obfuscated. Approach:

1. **Reverse-engineer the schema once per Marg version** using a real install (legal — it's the customer's own data structure, read via standard ODBC/DBF). Document each version's table/column layout.
2. **Build a mapping profile per version.** Detected version → profile → extraction queries.
3. **Maintain profiles as new Marg versions appear.** This is ongoing but bounded — a handful of versions cover most of the field.

This is why the **Week-1 spike is non-negotiable**: get one real Marg install, confirm the backend, read the item table, document the schema. Everything in §5 with an **[ASSUMPTION]** tag gets confirmed or corrected there.

---

## 8. Risks

- **RK-1 (High): Marg schema is obfuscated or undocumented.** Mitigation: the spike. If obfuscation is severe, fall back to the Excel-export path for that version.
- **RK-2 (High): Legal — Marg licensing may prohibit third-party DB access.** Mitigation: CA/lawyer review before release (R8). If prohibited, pivot fully to Excel path. *Resolve this before building.*
- **RK-3 (Medium): Pervasive ODBC requires credentials the customer doesn't have.** Mitigation: test on a real Pervasive-backed install in the spike; if blocked, DBF-only support + Excel fallback for newer versions.
- **RK-4 (Medium): Old Windows compatibility.** Mitigation: Go static binary; test on Windows 7 VM.
- **RK-5 (Medium): Customer trust — won't run an .exe on their live DB.** Mitigation: read-only + EV-signed + open-source + white-glove (your staff runs it, removing the customer's fear).
- **RK-6 (Low): Schema varies even within a version (custom fields).** Mitigation: graceful unknown-column handling; map what's recognized, log the rest.

---

## 9. Phasing

### Phase 0: Spike (Week 1) — go/no-go
- Get ODBC/DBF reading one real pilot-shop Marg install
- Confirm backend (DBF vs Pervasive), confirm read-only works
- Read and document the item table schema
- **Resolve RK-2 (legal) in parallel**
- **Exit:** can we read items from a real Marg? If yes → build. If no (legal or technical) → fall back to hardening the Excel path.

### Phase 1: Core extraction (weeks 2–5)
- Detector + DBF reader + Pervasive reader
- Item master + stock extraction with mapping
- Validation + preview UI (localhost, Salt design tokens)
- Match against Salt catalog

### Phase 2: Complete + upload (weeks 6–8)
- Parties, balances extraction
- Resumable upload to Salt migration API
- Idempotency, post-upload report
- EV signing, packaging as portable .exe

### Phase 3: Hardening (weeks 9–10)
- Multi-version mapping profiles (cover top 3–4 Marg versions seen in pilots)
- Top-up re-run
- Windows 7–11 testing
- Open-source release + trust documentation

**Note on sequencing vs parent PRD:** This tool's spike (Phase 0) should run *inside* the parent PRD's Phase 1 (Foundation), since migration is needed before pilot onboarding in the parent's Phase 2. The Migrator's Phases 1–3 align with the parent's Phase 2–3 window.

---

## 10. Success metrics

- **% of migrations via Migrator vs Excel** (target: >70% of new customers use the tool, not manual Excel)
- **Median migration time** (target: <20 min for a typical shop, white-glove or self-serve)
- **Migration completion rate** (started → successfully operating in Salt; target >90%)
- **Support touches per migration** (target: <1 for self-serve after the tool matures)
- **Data accuracy** (post-migration discrepancies reported by customers; target: near-zero on stock and balances)

---

## 11. Open questions

- **Q1.** Which Marg versions do the pilot shops run? (Determines DBF vs Pervasive priority.) — *resolve in spike*
- **Q2.** Does Marg's licensing prohibit third-party DB access? — *legal review, blocking, resolve before build*
- **Q3.** Does Marg's Pervasive engine require credentials for ODBC, and do customers have them? — *resolve in spike*
- **Q4.** Go vs .NET? — *founder/eng decision*
- **Q5.** Localhost-web UI vs native window? — *eng decision; localhost-web preferred for design-system reuse*
- **Q6.** Open-source fully, or source-available? — *trust vs IP tradeoff; lean open-source*
- **Q7.** Do we attempt transaction history in v1.1, or hold the line at masters+stock+balances? — *defer; decide after first 50 migrations*

---

## 12. The honest bottom line

This tool is the highest-leverage thing you can build for the "1,000 customers" goal *if* two gates pass:
1. **Legal (RK-2/Q2):** Marg's terms don't prohibit reading the customer's own DB. — must confirm first
2. **Technical (Phase 0 spike):** the schema is readable on real installs. — confirm week 1

If both pass, migration goes from your biggest barrier to a genuine competitive advantage Marg cannot counter. If either fails, the Excel path (hardened per the earlier discussion: guided wizard, validate-on-upload, catalog-matching, white-glove) remains a fully viable fallback — so this is a high-upside bet with a safe floor.

**Do not write production code until Q2 (legal) is answered and the Phase 0 spike confirms readability.**

---

*End of Salt Migrator PRD v0.1. Next: run the Phase 0 spike on a pilot shop's Marg install and get the legal review started in parallel.*
