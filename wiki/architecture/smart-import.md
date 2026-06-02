---
type: architecture
updated: 2026-06-02
tags: [import, marg, smart-import]
---

# Smart Import (module reference)

The **as-built** state of the Smart Importer — the file-based onboarding path that turns a whole Marg / Tally / Saral shop into live Salt data. This is the synthesis/overview; the deep design + phase history is [smart-import-extension](smart-import-extension.md), the original four-file mechanics are in [import-pipeline](import-pipeline.md), the full export→table scope is [marg-import-map](marg-import-map.md), and the operator how-to-export is [../domain/marg-export-guide](../domain/marg-export-guide.md).

**Status: complete.** Phases 0–7 of the extension shipped (see [smart-import-extension §9](smart-import-extension.md#9-phased-build-roadmap)) — masters, opening balances, full transaction history, compliance, opening-stock ledger, a drop-all auto-detect router, multi-branch targeting, and GSTR-2B reconciliation.

## 1. What it is

One generic machine, no per-customer code: the same field-alias + `autoMap` + report-aware `extractTable` engine absorbs every Marg export. A file's columns are matched to a target entity's fields (exact > substring > fuzzy), bad rows are **quarantined** for inline fixing, and **nothing is discarded** — every unmapped column is kept verbatim in the row's `source jsonb`. Money is integer **paise**; identity is **GSTIN→name** (parties), **`item_code`** (items), **reg-no→name** (doctors). History is loaded as **records only** (`posts_effects=false`) so it never double-counts against the opening snapshot ([ADR 0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md)).

## 2. Screens & flow

Entry: `/import` ([ImportPage](../../apps/web/src/components/import/ImportPage.tsx)) → the **Smart Import** cascade ([`SmartImportPage.tsx`](../../apps/web/src/components/import/smart/SmartImportPage.tsx)). Two ways in:

- **Step-by-step cascade** — a linear stepper, each step: *upload → auto-map columns → review/quarantine → import*. Order: **ledgers** (trial balance) → **party details** (GST master) → **items** → **batches & stock** → **opening stock** → **salesmen / doctors / branches** → **purchases / sales / sales-returns / purchase-returns** → **payments** → **H1 register / drug licences / GST returns / invoice series** → **GSTR-2B**.
- **Drop-all auto-detect router** ([`DropAllPanel`](../../apps/web/src/components/import/smart/DropAllPanel.tsx)) — drop every file at once; each is fingerprinted and routed to its step pre-loaded; low-confidence files fall back to manual.
- **Multi-branch selector** — multi-shop orgs pick which shop a run targets; the shop-scoped steps tag that `shop_id` (masters stay org-wide).

### Step components (`components/import/smart/`)
| Step | Component | Notes |
|---|---|---|
| Trial balance → ledgers + bills | `LedgerStep` | bespoke report parse + reconciliation QA; client-UUID ledger↔bill linkage |
| GST master enrich/complete | `PartyGstStep` | fill-only-nulls match by name; unmatched → new ledgers |
| Items, batches/stock, salesmen, doctors, branches, H1, licences, GST returns, invoice series | `EntityStep` | generic flat-master: upload → map → **quarantine grid** → insert/upsert; `shopScoped` + `upsertOn` config flags |
| Purchases / sales / credit-notes / debit-notes | `DocumentStep` | header+line registers grouped by doc-no |
| Receipts & payments | `PaymentStep` | flat single-row vouchers |
| Opening stock ledger | `OpeningStockStep` | posts one `opening` movement per batch |
| GSTR-2B + ITC recon | `Gstr2bStep` | import + reconcile vs purchases |
| (shared) column-map control | `MapGroup` | field→header dropdowns |

## 3. Key files (`apps/web/src/lib/`)

- **`smartParse.ts`** — `readMatrix` (CSV via papaparse, XLS/XLSX via SheetJS), `parseFile`→`extractTable`, `parseLedgerFile`→`extractLedgerReport`.
- **`smartImport.ts`** — `ENTITIES` (field+alias configs), `autoMap`/`fieldScore` (tiered), `extractTable` (report-aware), `partitionRows`/`revalidate`/`validate` (→ commit vs quarantine), `toPaise`/`toExpiryYM`/`toIsoDate`. `EntityConfig` carries `shopScoped`/`upsertOn`.
- **`smartLedger.ts`** — `extractLedgerReport`, `detectColumns`, `parseBill` (trial-balance positional parse + `opening+debit−credit=closing` reconciliation).
- **`smartDocument.ts`** — `DocumentConfig`, `groupDocuments`, `prepare{Purchases,Sales,CreditNote,DebitNote}`, `resolveParty`, `toIsoDate` — header+line registers as non-posting docs.
- **`smartPayment.ts`** — `preparePayments`, `normalizeDirection`/`normalizeMode` — flat vouchers.
- **`openingStock.ts`** — `planOpeningMovements` (one `opening` movement per batch; idempotent).
- **`fingerprint.ts`** — `classifyHeaders`/`classifyMatrix`/`scoreFields` for the drop-all router.
- **`gstr2b.ts`** — `prepareLines` + `reconcile` (match GSTR-2B vs purchases on GSTIN+invoice-no).
- Helpers: `classifyParties.ts` (`classify_parties` RPC), `selectAll.ts` (1000-row pagination), chunked inserts (`CHUNK=500`).

## 4. Data model, load paths & migrations

| Data | Path | Idempotency key |
|---|---|---|
| Masters / opening | direct **insert/upsert** | `items`=`(org,item_code)`; `gst_returns`/`invoice_series` upsert on their unique keys; others insert |
| History (pre-cutover) | direct **non-posting** insert (`posts_effects=false`) | `(org,shop,source_system,source_doc_no)` partial-unique |
| Opening stock | one `stock_movements` (`reason='opening'`) per batch | skip batches already having an opening movement |
| GSTR-2B | `gstr2b_imports`+`gstr2b_lines`, reconciled → `gstr2b_matches` | replace-per-period (cascade delete) |

Documents/lines link by **client-generated UUID** (never `RETURNING` order — [ADR 0007](../decisions/0007-client-side-uuid-generation.md)). Live posting RPCs (`create_sales_invoice`/`receive_purchase`/`record_payment`) are **never** used for history.

**Migrations** (run by the user in Supabase; all idempotent):
- `0013` — `source jsonb` on ledgers/items/batches (pre-existing).
- `0025` — `source_system`/`source_doc_no`/`posts_effects` + partial-unique index on `purchases` + `sales_invoices`.
- `0026` — same on `credit_notes` + `debit_notes`.
- `0029` — same on `payments`.
- `0030` — `doctors` table ([ADR 0014](../decisions/0014-doctors-master.md)) + nullable `doctor_id` FK on `h1_register`/`sales_invoices` + `source` on `salesmen`.
- `0031` — `source jsonb` on `h1_register`/`drug_licenses`/`gst_returns`/`invoice_series`.
- GSTR-2B, opening-stock, and multi-branch needed **no** migration (tables/enum values already live in `0014–0024`).

## 5. Decisions & gotchas

- **History never posts** — the opening snapshot (trial balance + batch stock) is authoritative at the shop's `cutover_date`; pre-cutover documents import with `posts_effects=false` ([ADR 0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md)/[0013](../decisions/0013-gl-history-depth.md)). GST splits are taken **verbatim** from Marg for history (only the live RPCs recompute).
- **Imported payments don't move dues** — the opening balance already nets pre-cutover receipts/payments, so `PartyProfilePage` excludes `posts_effects=false` payments from `paymentsAdjustment` (consumer-side fix landed as **SALT-166**, parties module).
- **Opening stock is ledger-only** — on-hand reads `batches.qty` (not a movement sum), so `opening` movements just complete the audit ledger; they never double-count.
- **Faithful capture** — unmapped columns persist in `source jsonb`; same-name parties are kept distinct and merged later by the user ([ADR 0005](../decisions/0005-faithful-import-and-merge.md)/[0008](../decisions/0008-import-join-keys.md)/[0010](../decisions/0010-gstin-canonical-party-identity.md)).
- **GSTR-2B is GST-portal data**, not a Marg export — imported + reconciled anyway; `gstr2b_matches` requires a line FK, so `missing_in_2b` is a summary count only.
- **Migration numbering races** across parallel chats — pick the next free number from `git ls-tree origin/main supabase/migrations/`, not the local tree.

## 6. Current state vs planned

**Shipped:** the entire phased roadmap (0–7) + opening-stock ledger + multi-branch + GSTR-2B + a design-token consistency pass (SALT-225). The importer covers masters → opening balances → all transaction history → compliance → GSTR-2B, with auto-detect routing and per-branch targeting.

**Deferred / out of scope (tracked):**
- Payment **allocations** (link a receipt to specific bills) — deferred; low value since imported payments don't move dues.
- H1 register **FK resolution** (`item_id`/`doctor_id`) — imports text-only today; linking to the `items`/`doctors` masters is a follow-up.
- Account-groups → `chart_accounts` — **dropped by decision** ([ADR 0013](../decisions/0013-gl-history-depth.md): GL history is opening-only).
- GSTR-2B **detailed match-browsing screen** — GST module (ties to the tax-report suite).
- The GL / purchase-invoice **onboarding** import-flow screens (`components/import/GlOpeningImportPage`, `PurchaseInvoiceImportPage`) are the *onboarding* module's, not smart-import's.

## Related
[import-pipeline](import-pipeline.md) · [smart-import-extension](smart-import-extension.md) · [marg-import-map](marg-import-map.md) · [../domain/marg-export-guide](../domain/marg-export-guide.md) · [data-model](data-model.md) · [schema](schema.md) · ADRs [0005](../decisions/0005-faithful-import-and-merge.md)/[0007](../decisions/0007-client-side-uuid-generation.md)/[0008](../decisions/0008-import-join-keys.md)/[0010](../decisions/0010-gstin-canonical-party-identity.md)–[0014](../decisions/0014-doctors-master.md). Raw sources: `salt-prd-v0.3.md` §4.10, `PRD_Intelligent_Importer.pdf`.
