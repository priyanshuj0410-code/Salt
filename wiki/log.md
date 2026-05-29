---
type: log
updated: 2026-05-29
---

# Log

Append-only timeline. One entry per ingest / build / decision / lint. Newest at the bottom. Consistent prefix so it greps: `grep "^## \[" log.md | tail -5`.

## [2026-05-28] build | Counter billing screen
Keyboard-driven billing: salt/name search, FEFO batch picker, per-line qty/discount, earnings/loss, cash-vs-credit. Zustand bill + catalog stores.

## [2026-05-28] build | Auth + multi-tenancy
Supabase Auth (email/password + Google), `orgs`/`memberships`, owner/cashier roles, onboarding (create org / join by code), strict per-org RLS. Migrations 0001–0003, 0006.

## [2026-05-28] build | Catalogue + items/batches
`items`/`batches` (migration 0004, RLS), CSV catalogue importer, billing reads org data.

## [2026-05-28] build | Go migrator
Marg DBF → upload via `redeem_migration_token` (migration 0005). Cross-compiled to Windows, downloadable from the site.

## [2026-05-29] build | Smart Importer
Cascade stepper (ledgers → items → batches) with Levenshtein auto-map, report-aware `extractTable`, and quarantine grid. PRs #8 (importer) and #9 (report-aware extraction).

## [2026-05-29] decision | Capture trial-balance financials
Don't drop the trial balance's numbers — capture signed opening balances + per-invoice open bills, classify parties, run quality checks. → [decisions/0006](decisions/0006-trial-balance-column-identity.md)

## [2026-05-29] build | Ledger financials (Stage 1)
`smartLedger.ts` (positional column parse + column-identity reconciliation), `ledger_bills`, `known_vendors`, `classify_parties` (migration 0008). Verified: 475 ledgers, 4,344 bills, 475/475 reconcile exactly. PR #12.

## [2026-05-29] decision | Faithful import + user-driven merge
Same-name parties are real distinct accounts; keep them, merge by GSTIN/invoice-set/name with user confirmation. → [decisions/0005](decisions/0005-faithful-import-and-merge.md)

## [2026-05-29] build | Parties screen + merge (Stage 2)
Owner `/parties` screen (edit type/GSTIN/phone, balances, bills) + `mergeSuggest.ts` + `merge_ledgers` RPC (migration 0009). PR #11. Stack #9→#12→#11 landed on main.

## [2026-05-29] ingest | PRDs + design docs + as-built + decisions
Created this wiki. Ingested `salt-prd-v0.3.md`, `design.md` (and referenced the migrator PRD + design-system HTML), the as-built codebase (migrations 0001–0009), and the session's decisions. Seeded product / architecture / domain / decisions pages, index, and overview.
