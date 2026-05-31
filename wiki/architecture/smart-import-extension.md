---
type: architecture
updated: 2026-05-31
tags: [import, marg, smart-import, design]
---

# Smart Import extension — full Marg → Salt ingestion

Design for growing [Smart Import](import-pipeline.md) from the **four-file cascade** (masters + opening balances) to **the whole live model** — every Marg export, including transaction history and compliance. Companion to the data map ([marg-import-map](marg-import-map.md)) and the operator playbook ([../domain/marg-export-guide](../domain/marg-export-guide.md)); governed by ADRs [0010](../decisions/0010-gstin-canonical-party-identity.md)–[0014](../decisions/0014-doctors-master.md).

**Status: design only — no code yet.**
- **UX:** extend the existing cascade stepper; a drop-all auto-detect router is **deferred** (see §9).
- **Schema:** the import-extension columns/tables below are **net-new** — nothing is scaffolded today (`supabase/migrations/` stops at `0013`; the live model is `supabase/proposed/0014–0024` applied via `full_data_model.sql`).
- **Mappings:** designed from the known Marg ERP 9+ structure; tuned when a real sample arrives (auto-map tolerates header variance meanwhile).

## 1. Goal & scope

Onboard a complete Marg shop from files: **masters** (parties, items, salesmen, doctors, groups, branches), **opening balances** (trial balance, outstanding, batch stock), **transaction history** (sales, purchases/GRN, returns, payments, transfers, adjustments), and **compliance** (Sch-H/H1, drug licences, GST). One generic machine, no per-customer code — the same field-alias + `autoMap` + `extractTable` engine that already absorbs the four files.

## 2. Architecture — three layers

### Parse / extract (reuse as-is)
- `lib/smartParse.ts` — `readMatrix` (CSV via papaparse, XLS/XLSX via SheetJS), `parseFile` → `extractTable`, `parseLedgerFile` → `extractLedgerReport`.
- `lib/smartImport.ts` — `extractTable` (report-aware), `autoMap`/`fieldScore` (tiered exact > substring > fuzzy), `partitionRows`/`revalidate` (validate → commit vs quarantine), `toPaise`, `toExpiryYM`.
- `lib/smartLedger.ts` — `extractLedgerReport`, `detectColumns`, `parseBill` (trial-balance specific).

### Identity & dedup
- **Parties** — GSTIN (canonical) → normalized name (fallback) ([0010](../decisions/0010-gstin-canonical-party-identity.md)).
- **Items** — `item_code` across master, stock, and every transaction line.
- **Doctors** — registration no → name ([0014](../decisions/0014-doctors-master.md)).
- **Documents** — insert-or-skip on `source_doc_no` ([0011](../decisions/0011-document-import-idempotency-key.md)).

### Load paths (the key split)
| Data | Path | Why |
|---|---|---|
| Masters, opening | **Direct insert/upsert** (current pattern; reuse `classifyParties`, `selectAll`, client-UUID linking) | Idempotent on natural keys |
| **History (pre-cutover)** | **Direct header+line insert that does NOT post** stock/ledger effects; `posts_effects = false` | Snapshot is authoritative; replaying would double-count ([0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md)/[0013](../decisions/0013-gl-history-depth.md)). This is exactly what the live `0018` cutover SQL already does (insert `sales_invoices`/`sale_lines` from history without re-posting). |
| Live ops (post-cutover) | Posting RPCs `create_sales_invoice` / `receive_purchase` / `create_credit_note` / `create_debit_note` / `record_payment` | They move stock + post double-entry — **never used for historical import** |

(Optional: a security-definer `import_document(shop, doc_type, header, lines)` RPC if atomic header+line or very high volume demands server-side insertion — but direct client inserts match the existing importer and the `0018` precedent, so they are the default.)

## 3. File set → load path

From [marg-import-map](marg-import-map.md), annotated with the importer mechanics. Status: ✅ today · 🔜 build.

| Marg file | → table(s) | Identity / join | Load | Status |
|---|---|---|---|---|
| Account/Ledger master (+GST) | `ledgers` | GSTIN→name | upsert | ✅/🔜 |
| Item/Product master | `items` | `item_code` | upsert | ✅ |
| Salesman master | `salesmen` | name | insert | ✅ |
| Doctor master | `doctors` | reg-no→name | insert | ✅ |
| Account groups | `chart_accounts` | group→code map | upsert | 🔜 |
| Branch list | `shops` (+`cutover_date`) | code | insert | ✅ |
| Trial Balance | `ledgers.opening_balance_paise` + opening `ledger_entries` | name | ledger path | ✅ |
| Bill-wise Outstanding | `ledger_bills` | party name | insert | ✅ |
| Batch-wise stock | `batches` + opening `stock_movements` | `item_code`→name | insert | ✅/🔜 |
| Sales register | `sales_invoices`+`sale_lines` | doc-no; party; item_code | non-posting insert | 🔜 |
| Sales returns | `credit_notes`+lines | doc-no | non-posting insert | 🔜 |
| Purchase/GRN register | `purchases`+`purchase_lines` (free_qty, scheme) | doc-no; vendor; item_code | non-posting insert | 🔜 |
| Purchase returns | `debit_notes`+lines | doc-no | non-posting insert | 🔜 |
| Receipts/Payments | `payments` (allocations deferred) | voucher-no; party | non-posting insert | ✅ |
| Stock transfers | `stock_transfers`+lines | doc-no | non-posting insert | 🔜 |
| Stock adjustments | `physical_counts`/`stock_movements` | — | insert | 🔜 |
| Sch-H/H1 register | `h1_register` | — | insert | 🔜 |
| Drug licences | `drug_licenses` | — | insert | 🔜 |
| GSTR-1/3B summaries | `gst_returns` (archive) | period | insert | 🔜 |
| Voucher series / last no | `invoice_series` | shop+doc_type+FY | upsert | 🔜 |

## 4. UX — extend the cascade stepper

Keep `SmartImportPage.tsx`'s linear stepper; add new entity configs to `ENTITIES` (`smartImport.ts`) with FieldDef + aliases per file, grouped into **skippable sections**:

1. **Masters** — ledgers, party-GST, items, salesmen, doctors, groups, branches.
2. **Opening** — trial balance, outstanding, batch stock.
3. **History** — purchases/GRN, sales, returns, payments, transfers, adjustments.
4. **Compliance** — H1 register, drug licences, GST archive, invoice series.

Step components:
- **`EntityStep`** (reuse) — flat masters: upload → column-map → quarantine grid → upsert.
- **`LedgerStep`** (reuse) — the trial balance (already bespoke).
- **`DocumentStep`** (new) — header+line registers (see §5).

*Deferred — auto-detect router:* fingerprint a dropped file by scoring its headers against each entity's aliases (`fieldScore`/`autoMap`) plus structural signals (a trial balance is whatever `detectColumns` recognizes; a register has a repeated doc-no + line columns), route to the best match, and offer a "drop everything" dropzone. Out of scope for the first build; the stepper is the path.

## 5. Document import path (the new core)

Register exports are **one row per line**. A new `groupDocuments(rows, mapping)` helper:
1. Groups rows by document number → `{ header, lines[] }` (header fields = first non-null across the group).
2. Generates a client UUID for the header (the `LedgerStep` ledgers+bills pattern — link lines by explicit id, never by `RETURNING` order; see [0007](../decisions/0007-client-side-uuid-generation.md)).
3. Inserts header (with `source_system`, `source_doc_no`, `posts_effects=false`) then its lines, chunked.
4. Idempotent: insert-or-skip on the `source_doc_no` unique key ([0011](../decisions/0011-document-import-idempotency-key.md)).

New entity configs for sales / purchase / returns / payments carry **line** fields (item_code, batch, expiry, qty, free_qty, ptr/mrp, gst splits, line_total). **Use Marg's provided CGST/SGST/IGST verbatim for history** — don't recompute (the posting RPCs recompute; the import path must not).

## 6. Net-new schema (build later, run by user)

A single import-extension migration (the next number after the applied model):
- `shops.cutover_date date` ([0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md)).
- On each importable doc table (`sales_invoices`, `purchases`, `credit_notes`, `debit_notes`, `payments`, `stock_transfers`, `journal_vouchers`): `source_system text`, `source_doc_no text`, `posts_effects boolean not null default true`, and a **partial unique index** `(org_id, shop_id, source_system, source_doc_no) where source_doc_no is not null` ([0011](../decisions/0011-document-import-idempotency-key.md)).
- `doctors` table + nullable `doctor_id` FK on `h1_register` (and optionally `sales_invoices`) ([0014](../decisions/0014-doctors-master.md)).
- Optional: a `chart_accounts` group-mapping helper and a read-only period-summary archive ([0013](../decisions/0013-gl-history-depth.md)).

## 7. Cutover boundary

The opening snapshot (trial balance + batch stock) is **authoritative** for balances and on-hand at `cutover_date`. Pre-cutover documents import as records with `posts_effects=false` (no `stock_movements`, no `ledger_entries`). Post-cutover, billing/purchasing flows through the normal posting RPCs. One date per shop; multi-branch = one export set per shop.

## 8. Reuse map

- Parse/map/validate: `lib/smartParse.ts`, `lib/smartImport.ts`, `lib/smartLedger.ts`.
- Helpers: `lib/classifyParties.ts` (`classify_parties`), `lib/selectAll.ts` (1000-row pagination), chunked inserts (`CHUNK = 500`).
- UI: `components/import/smart/{SmartImportPage,LedgerStep,PartyGstStep,EntityStep}.tsx`.
- SQL precedent: `supabase/proposed/0018_sales.sql` (historical insert without re-posting); `0019–0024` define the live doc tables + the posting RPCs (NOT for history).

## 9. Phased build roadmap

Each phase = a staged PR (+ migration where noted), verified with `pnpm lint && pnpm build`, a sample import, and a no-double-posting check.

- **Phase 0 — schema:** ✅ shipped (`0025_import_extension.sql`, run by user) — `shops.cutover_date` + source-doc idempotency/`posts_effects` on `purchases` + `sales_invoices`. (`doctors` + the remaining doc tables follow in their phases.)
- **Phase 1 — Purchase/GRN history:** ✅ shipped (branch `feat/smart-import-purchases`) — `lib/smartDocument.ts` (`groupDocuments`/`preparePurchases`) + `DocumentStep.tsx`, wired into the stepper. The authentic batch + cost source.
- **Phase 2 — Sales history:** ✅ shipped — `SALES_DOC` config + `prepareSales` (party GSTIN→name, **walk-in allowed**; MRP-inclusive tax backed out, CGST/SGST split for display) + `prepareDocuments` dispatch; `DocCtx` generalized `vendorBy*`→`partyBy*`. **Dues fix:** `PartyProfilePage` now excludes imported (`posts_effects=false`) docs from amount-due (already in opening balance) while still listing them tagged "imported"; `BillHistoryPage` tags them too. No new migration (0025 pre-staged `sales_invoices`).
- **Phase 3 — Returns:** ✅ shipped (SALT-149, #52) — `CREDIT_NOTE_DOC`/`DEBIT_NOTE_DOC` configs + `prepareCreditNote`/`prepareDebitNote` (MRP-inclusive credit notes; tax-exclusive debit notes with `itc_reversal_paise`); migration `0026_import_returns.sql` adds source-doc/`posts_effects` to `credit_notes`+`debit_notes`. Returns don't feed `PartyProfilePage` dues, so no parties change was needed.
- **Phase 4 — Payments/receipts:** ✅ shipped (SALT-150) — `lib/smartPayment.ts` (`PAYMENT_CONFIG` + `preparePayments` + `normalizeDirection`/`normalizeMode`) + the flat `PaymentStep.tsx`, wired into the stepper after the document registers; migration `0029_import_payments.sql` adds source-doc/`posts_effects` to `payments` (**run it**). A voucher is a single flat row (not header+lines): direction comes from separate received/paid amount columns → a Type column → a default-direction toggle; mode normalizes to the live enum (never `adjustment`); party (**NOT NULL**) resolves GSTIN→name (unresolved → quarantined); voucher-no is the dedup key (blank/duplicate → quarantined). **Dues decision:** imported payments are records only (`posts_effects=false`) and must **not** adjust party dues — the opening balance already nets every pre-cutover receipt/payment (ADRs [0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md)/[0013](../decisions/0013-gl-history-depth.md)); counting them again would reduce the due twice. The consumer-side exclusion (skip `posts_effects=false` in `PartyProfilePage`'s `paymentsAdjustment`) is a **parties-module** change, filed as **SALT-166**. Allocations deferred (PRD-optional; low value since imported payments don't move dues).
- **Phase 5 — Masters expansion:** ◐ partial (SALT-151) — **salesmen**, **doctors**, and **branches (`shops`)** now import as flat `EntityStep` masters (new `EntityKey`s + `ENTITIES` configs + `validate` branches in `smartImport.ts`; `EntityStep`/`SmartImportPage` unchanged — the generic insert handles org-scoped tables that carry a `source` column, and steps render from `ENTITIES` automatically). Migration `0030_masters_expansion.sql` creates the `doctors` table (ADR 0014, identity reg-no→name), adds a nullable `doctor_id` FK on `h1_register` + `sales_invoices`, and adds `source jsonb` to `salesmen` (`shops` already had it). Masters insert (no dedup — re-import adds rows, like the existing masters bar `items`). **Deferred to follow-ups:** opening `stock_movements` per batch at cutover → **SALT-183** (needs post-insert batch-id capture + inventory coordination); full multi-branch cascade tagging → **SALT-184** (blocked on the shop-switcher SALT-090 — the `shops` master imports now, but per-branch data still tags the *active* shop). Account groups → `chart_accounts` is **dropped by decision** (ADR 0013 keeps GL history opening-only, so the group map is unneeded).
- **Phase 6 — Compliance:** H1 register, drug licences, GST-returns archive, invoice-series continuity.
- **Future/optional:** drop-all auto-detect router (§4).

## 10. Risks / open

- **Line grouping** — depends on a stable doc-no column; fall back to (date+party+running-block) if absent.
- **Volume** — registers can be lakhs of rows; reuse chunking + `selectAll`; consider the `import_document` RPC if client inserts are too slow.
- **Column variance** — mitigated by `autoMap` + the manual mapping step + tuning once samples land.
- **GST splits** — trust Marg's figures for history; only the live RPCs compute splits.
- **GSTR-2B** — comes from the GST portal, not Marg.

## Related

[import-pipeline](import-pipeline.md) · [marg-import-map](marg-import-map.md) · [../domain/marg-export-guide](../domain/marg-export-guide.md) · [proposed-data-model](proposed-data-model.md) · [schema](schema.md) · ADRs [0010](../decisions/0010-gstin-canonical-party-identity.md) · [0011](../decisions/0011-document-import-idempotency-key.md) · [0012](../decisions/0012-stock-cutover-snapshot-vs-replay.md) · [0013](../decisions/0013-gl-history-depth.md) · [0014](../decisions/0014-doctors-master.md)
