---
type: architecture
updated: 2026-06-02
tags: [onboarding, import, first-run, gstin, cutover]
---

# Onboarding module

How a new shop goes from signup to its first bill: account + GSTIN signup, a first-run
**setup wizard**, an always-visible **completeness checklist**, and a family of **import
flows** (catalogue, purchase invoices, GL opening balances) that seed stock, payables,
and the books. It sits on top of the [information architecture](information-architecture.md)
and the [import pipeline](import-pipeline.md). Screens live under
`apps/web/src/components/onboarding/` and `apps/web/src/components/import/`; the auth/shop
entry points are in `components/auth/` and `components/settings/`.

The module spans several existing code modules (auth, nav, owner, smart-import, database)
rather than a single directory — see the module map note under "Key files".

---

## Surfaces (what was built)

### Signup + GSTIN auto-prefill — SALT-120
- `components/auth/OnboardingPage.tsx` "Create org" gains an **optional GSTIN** field; as you
  type a valid GSTIN the billing **state is derived and shown** live.
- `lib/gstin.ts` validates a GSTIN: 15-char shape · known 2-digit state code · the GSTN
  **mod-36 check digit**. Exposes `{ valid, stateCode, stateName, pan }`. (Looking up the legal
  name/address would need an external GST-registry API — deliberately not wired.)
- On submit, after `create_org` returns the org id, the org's **primary shop** is updated with
  `state_code` + `gstin` in one client-side follow-up write — so the owner is never interrupted
  by the just-in-time `ShopSetupDialog` (shop state is billing's hard blocker). No change to the
  cumulative `create_org` RPC was needed.

### First-run setup wizard — SALT-122 · completeness checklist — SALT-124
- `/setup` (owner-only) → `components/onboarding/SetupWizard.tsx`: a **6-step checklist** —
  shop → users → printer → import → GRN → sale. It does not re-implement those screens; each
  step **deep-links to the real one** and tracks completion from **live state**.
- `components/onboarding/useSetupProgress.ts` is the single source of truth (shared with the
  nudge): `shop.state_code` plus per-org counts of `memberships`/`invites`, `items`,
  `purchases`, `sales_invoices`; the printer step has no backend so it is acknowledged in
  `localStorage`. Refreshes on window focus, so steps tick off as the owner works.
- `components/onboarding/SetupChecklist.tsx`: a compact progress nudge on the **owner home**
  (`components/owner/OwnerHome.tsx`) that self-hides once the required steps are done.
- New owners are routed to `/setup` right after `create_org`.

### Import hub + fixed-CSV catalogue import + templates — SALT-121 / SALT-127
- `components/import/ImportPage.tsx` is the hub linking every path (Smart Import, purchase
  invoices, GL openings, fixed CSV, Marg migrator).
- `lib/import.ts`: a fixed-column catalogue importer with **Salt / Marg / Tally starter
  templates** (`IMPORT_TEMPLATES`) and **header canonicalization** (`canonicalHeader`) so a
  Marg/Tally export drops in without the fuzzy Smart-Import flow.
- Commit is an explicit **dry run → atomic apply**: the preview says "nothing saved yet"; the
  apply goes through the `import_catalog` RPC (one transaction, full rollback on error), with a
  best-effort legacy multi-step fallback before migration 0028 is applied (no regression).

### Posting purchase-invoice importer — SALT-125
- `/import/purchases` → `components/import/PurchaseInvoiceImportPage.tsx` + `lib/importPurchaseInvoice.ts`.
- Upload a one-row-per-line vendor-bill CSV (template + header aliasing), grouped into invoices,
  with a dry-run preview (per-invoice vendor, totals via `grnTotals`, new-vendor/new-item flags).
- On commit each invoice **POSTS through `receive_purchase`** — adding stock, the vendor payable,
  and ITC, exactly like a hand-entered GRN. This is the opposite of Smart Import's purchase
  *register*, which is a non-posting history load (see [import-pipeline](import-pipeline.md)).
- **Auto-create**: vendors missing from `ledgers` are created (`type='supplier'`, GSTIN + derived
  `state_code`); items missing from the catalogue are created (matched by `item_code` → `barcode`
  → name). Per-invoice result report.

### GL opening-balance import — SALT-126
- `/import/gl` → `components/import/GlOpeningImportPage.tsx` + `lib/importGlOpening.ts`.
- The **non-party** side of a trial balance: Cash / Bank / Stock / Capital / loans / fixed assets.
  Upload a `code,name,type,debit,credit` CSV with a dry-run preview (per-account Dr/Cr, on-file vs
  new, totals + balanced indicator; the difference flows to Opening Balance Equity).
- Commit posts via the atomic `import_gl_opening` RPC — resolve/create the `chart_accounts` row,
  then post the **account side + an OB-Equity contra** as balanced `ledger_entries`
  (`ref_table='opening'`), idempotent per account. **Party** debtor/creditor openings come from
  Smart Import (the trial-balance step), not here.

---

## Data model · RPCs · migrations

| Thing | Where | Note |
|---|---|---|
| `create_org(name)` | proposed 0014 → 0017 | Seeds org + membership + primary shop + chart of accounts. Cumulative — never redefined by onboarding. |
| `import_catalog(jsonb)` | **migration 0028** (new) | Atomic items + batches insert; owner-only, org-scoped. |
| `import_gl_opening(jsonb)` | **migration 0029** (new) | Atomic GL openings → `ledger_entries` (account + OB-Equity contra), idempotent per account. |
| `receive_purchase(...)` | proposed 0019 | Reused by the purchase importer; derives the CGST/SGST/IGST split from vendor-vs-shop state itself. |
| `shops` | 0014 | `state_code`/`gstin` pre-filled at signup. |
| `ledgers` | 0007 (+`state_code` 0012, `opening_balance_paise`) | Vendors auto-created here. |
| `items` (`item_code` unique per org) / `batches` | 0004 (+0012) | Catalogue + stock. |
| `chart_accounts` / `ledger_entries` | proposed 0017 | Double-entry backbone the GL import posts into. |

Money is integer paise throughout (see [decision 0003](../decisions/0003-money-as-paise.md)).
Migrations 0028 + 0029 are applied to the live DB; both use `create or replace`, so they are
re-runnable.

---

## Decisions & gotchas

- **GSTIN checksum** is the GSTN mod-36 algorithm (verified against `27AAPFU0939F1ZV`). State is
  derived deterministically from the first two digits; GSTIN stays optional and never blocks signup.
- **Shop prefill is a client-side follow-up `update`** on `shops`, not a change to `create_org` —
  avoids forking the cumulative create-org RPC chain.
- **Atomic import RPCs degrade gracefully**: catalogue import falls back to the legacy multi-step
  path (with compensating cleanup) before 0028; GL import shows a "run 0029" notice until applied.
- **Posting imports are not idempotent yet** — re-running re-posts (flagged in-UI). The non-posting
  Smart-Import registers use a [document idempotency key](../decisions/0011-document-import-idempotency-key.md);
  bringing that to the posting importer is an open follow-up.
- **GL contra per line** keeps every line balanced; idempotency is per account on `ref_table='opening'`.
  Don't post Sundry Debtors/Creditors via the GL importer — they roll up from party balances.
- **Pure parsers, type-only imports** (`lib/gstin.ts`, `lib/import.ts`, `lib/importPurchaseInvoice.ts`,
  `lib/importGlOpening.ts`) so they unit-test with a throwaway `node smoke-*.ts`.
- **Design tokens**: the import screens use canonical `@theme` tokens (SALT-232) — no
  `text-muted-foreground` / `bg-muted` / `zinc-*`.

### Key files (cross-module)
`components/auth/OnboardingPage.tsx` · `components/onboarding/{SetupWizard,SetupChecklist,useSetupProgress}` ·
`components/owner/OwnerHome.tsx` · `components/import/{ImportPage,PurchaseInvoiceImportPage,GlOpeningImportPage}` ·
`lib/{gstin,import,importPurchaseInvoice,importGlOpening}.ts` · `supabase/migrations/0028,0029` ·
routes in `App.tsx`. The projectkit module map has no single "onboarding" module — these land in
auth / nav / owner / smart-import / database, plus the unmapped `components/onboarding/` dir.

---

## Current state vs planned

- **Shipped:** SALT-120, 121, 122, 124, 125, 126, 127, 232.
- **Reassigned:** SALT-123 (Windows ODBC Salt Migrator) → the **migrator** lane, blocked on legal
  gate **RK-2**; the Phase-0 schema spike is ungated and can proceed there. Cf.
  [marg-import-map](marg-import-map.md), [smart-import-extension](smart-import-extension.md) and
  `salt-migrator-prd-v0.1.md`.
- **Known gaps:** printer config has no backend (acknowledged client-side); posting-import
  idempotency; GST-registry name/address lookup at signup. Per `salt-prd-v0.3.md` the under-2-min
  onboarding goal is met for the keyboard-first owner.

## Related
[information-architecture](information-architecture.md) · [import-pipeline](import-pipeline.md) ·
[grn](grn.md) · [data-model](data-model.md) · [domain/trial-balance](../domain/trial-balance.md) ·
[decision 0011 — import idempotency](../decisions/0011-document-import-idempotency-key.md) ·
[decision 0012 — stock cutover](../decisions/0012-stock-cutover-snapshot-vs-replay.md)

Raw sources: `salt-prd-v0.3.md`, `PRD_Intelligent_Importer.pdf`, `salt-migrator-prd-v0.1.md`.
