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

## [2026-05-29] fix | Link imported bills to ledgers by explicit UUID
Bills were linked by index-aligning the `RETURNING` result of a multi-row `INSERT`, which Postgres does not guarantee. Now generates each ledger's UUID client-side (`crypto.randomUUID()`), supplies it in the `INSERT`, and links `ledger_bills` by the same id. Correct-by-construction. Verified: 475 unique UUIDs, 4,344 bills, 0 orphans. → [decisions/0007](decisions/0007-client-side-uuid-generation.md) · PR #14.

## [2026-05-29] ingest | Information architecture
Navigation tree (8 primary modules + Catalogue + Settings), screen inventory (25 screens), full keyboard shortcut system (G+letter go-to, N/E/Esc/Ctrl+S universal, billing F9/Ctrl+K), 7 user journey flows (morning review, GRN, billing, customer payment, expiry return, monthly GST, drug inspector), role matrix, URL structure. → [architecture/information-architecture](architecture/information-architecture.md)

## [2026-05-29] ingest | Product module map
Defined 21 modules across 4 tiers derived from PRD, market research, and persona. Tier 1 (Core): Catalogue, Counter/Billing, Purchase/GRN, Inventory, Customers, Vendors. Tier 2 (Complete): Payments, Returns, GST/Compliance, Reports. Tier 3 (Differentiate): Expiry Management, H1/X Compliance, GSTR-2B Reconciliation, WhatsApp, Drug License Alerts, Salesman. Tier 4 (Enterprise): Multi-store, B2B Portal, Purchase OCR, ABHA, ONDC. Critical unlock: sales persistence + GRN tables. → [product/product-modules](product/product-modules.md)

## [2026-05-29] ingest | User persona — wholesale medicine shop owner
Deep persona: Santosh Agarwal archetype. Multi-counter wholesale dealer in tier 2/3 India. Marg 9+ power user (F2/F3/F4 muscle memory). Internet drops 2–5×/day — offline billing is non-negotiable. Business runs on credit (₹20–80L receivables outstanding). Five core jobs-to-be-done: bill fast without stopping, know who owes money, know what's expiring, file GST without 4 accountant-days, survive the drug inspector. Key design implications: keyboard-first always, real-time cross-counter stock sync, hard H1 gate, WhatsApp ledger share in one click. → [domain/persona-wholesale-owner](domain/persona-wholesale-owner.md)

## [2026-05-29] ingest | Market research — Indian pharma retail ERP landscape
Researched major competitors (Marg, GoFrugal, RetailGraph, eVitalRx, Tally+TDL), GST compliance requirements (MRP-inclusive billing, GSTR-2B reconciliation, ITC reversal on expired stock, e-invoicing thresholds), Schedule H/H1/X legal requirements (mandatory register fields, 3-year retention, sale-blocking enforcement), industry pain points, and modern trends (offline-first gap, AI purchase invoice OCR, WhatsApp, ABHA/ABDM, ONDC). Added → [product/market-research](product/market-research.md). Updated [product/roadmap](product/roadmap.md) with market-informed priority additions.

## [2026-05-29] ingest | Billing screen, routing, and UUID decision
Added wiki pages for the billing screen architecture (`architecture/billing-screen.md`), app routing and access rules (`architecture/screens-routing.md`), and ADR 0007 for client-side UUID generation. Updated `import-pipeline.md` to remove stale index-alignment claim.

## [2026-05-29] build | Bill persistence + customer-on-bill + history (PR1)
Sales now persist. Migration 0010 adds `orders` + `order_lines` + the `place_order` RPC (atomic insert + sale stock-decrement + cash/credit settlement). Billing screen gains a customer picker (default Walk-in, Ctrl+K) bound in `useBill`; the Save button (F9) is enabled and calls `place_order` (disabled on the demo seed catalogue). New `/bills` history page lists every saved sale with line detail. Pure money/due helpers in `lib/orders.ts`. First of three staged PRs for party profiles + orders. → [domain/orders](domain/orders.md)

## [2026-05-29] build | Party profile page (PR2)
`/parties/:id` (`PartyProfilePage`): editable details (name/type/gstin/phone/address/credit-limit → `ledgers`), amount-due summary (`partyDue` = opening balance + unsettled orders), that party's order history, and the imported open bills (breakdown of opening balance). Party names on `/parties` link in via a new trailing column. "New sale" binds the customer (`useBill.setParty`) and jumps to billing, so the saved order links back by `party_id`. Vendor "New purchase" stubbed for PR3. Second of three staged PRs. → [domain/orders](domain/orders.md)

## [2026-05-29] build | Vendor purchases — place orders TO a party (PR3)
Migration 0011 extends `place_order` with the purchase branch: upserts the received batch (increment qty if (org,item,batch) exists else insert), refreshes ptr/mrp/expiry, and increases the payable. New `PurchaseEntryPage` at `/parties/:id/purchase` (GRN-lite): item search over the catalogue, per-line batch/expiry/qty/PTR/MRP, cash/credit payment, Save → `place_order` (purchase) → back to the vendor profile. Vendor profile "New purchase" button now wired (was a stub). `buildPurchasePayload` in `lib/orders.ts`. Purchases use existing catalogue items; disabled on the demo seed. Third of three staged PRs — completes "place orders for them or to them, track previous orders and amount due". → [domain/orders](domain/orders.md)

## [2026-05-29] fix | Stuck "Loading…" on tab refocus
`onAuthStateChange` set `loading=true` on every truthy session event, but Supabase re-fires it on tab focus / token refresh with the same user; `loading` was only cleared by the membership effect (keyed on `user.id`), which does not re-run for the same user — so the app stranded on the full-screen loader until a manual refresh. Fixed by gating `loading` on a real `user.id` change via a `useRef`; same-user refires now no-op (also avoids a redundant membership refetch on every focus). → [architecture/screens-routing](architecture/screens-routing.md)

## [2026-05-29] ingest | Schema reference page
Added [architecture/schema](architecture/schema.md): exact table + column definitions (type, nullability, default, FK, notes) for all 12 tables across migrations 0001–0012, plus conventions, the `user_role` enum, and a relationships diagram. Plus a **sample-file provenance** section mapping each source column (Trial Balance / partygstmaster / hsncodemaster / stock_81) to the Salt column it fills, with the unused columns called out. Linked from index and data-model.

## [2026-05-29] build | Four-file import cascade — party + product enrichment
Extended the Smart Importer to ingest a real Saral shop's four exports as two spine+enrichment clusters: **ledgers → party details → items → batches/stock**. Parties join by normalized name (Trial Balance spine, Party GST Master enriches GSTIN/phone/address/state, dedup-by-name, fill-only-nulls); products join by `item_code` (HSN master spine, Stock report links by code — verified 7,871/7,871 on the real file, 0 name-fallback). Migration 0012 adds `items.item_code` (unique per org), `ledgers.state_code`, `orgs.state_code`. Items upsert on code (idempotent); `autoMap` scoring made tiered (exact > substring > fuzzy, ties to first) so lookalike columns (ItemCode/HSNCode/HsnName, SGST/CGST/IGST) map right; `gst_rate` reads the combined IGST. `PartyGstStep.tsx` (enrichment), `EntityStep.tsx` (code-join + upsert), `smartImport.ts` (fieldScore/autoMap, item_code field, opening-stock MRP rule). → [decisions/0008](decisions/0008-import-join-keys.md)

## [2026-05-30] fix | Harden order saves (timeout + no duplicate submit)
Live verification showed `place_order` (sale) persists correctly — order, walk-in link, cash=paid, and stock decrement all confirmed against the real DB — but the client could hang on "Saving…" when the RPC response didn't return (a CDP/automation artifact here, but a real risk on flaky networks), which invited a duplicate by retrying. Added `withTimeout` + `TimeoutError` to `lib/orders.ts`; `BillSummary.save` and `PurchaseEntryPage.save` now race `place_order` against a 15s timeout, guard re-entry (blocks F9 while saving), and on timeout show a cautionary "may have gone through — check before saving again" message instead of stranding. → [domain/orders](domain/orders.md)
