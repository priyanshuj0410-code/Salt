---
type: architecture
updated: 2026-06-02
tags: [reports, analytics, dashboard, accounting, gst]
---

# Reports & analytics

The **Reports** module (`R`, `g r`) — the owner's read surface over everything the
operational modules write. One dashboard plus five report suites, all owner-gated,
each a single screen with switchable views, a cross-shop scope switcher, and CSV
export. Built across **seven shipped tickets**: SALT-073 (dashboard), 074 (sales),
075 (purchase), 076 (inventory), 077 (financial), 078 (tax), and 118 (the
cross-shop switcher).

Maps the [Reports & Analytics product module](../product/product-modules.md) onto
the [information architecture](information-architecture.md) `/reports/*` routes.

## The reporting basis (read it first)

Every report reads **operational, post-cutover documents** — the same filter the
[GST module](gst-returns.md) uses, so figures reconcile across modules:

- Sales/purchases: `status` active (`placed` / `received`) **and `posts_effects = true`**.
- Imported pre-cutover history (`posts_effects = false`) is **excluded** — those
  balances live in `ledgers.opening_balance_paise` / `ledger_bills` and surface in
  the [Parties](../domain/parties.md) module, not re-counted here.
- "Today" / month boundaries are computed in **IST** (`istToday`), so a UTC cloud
  clock never stamps a day's sales onto the wrong date.

This is documented inline on each page and is the single most important thing to
preserve when extending a report.

## Data sources

Reports lean on the purpose-built **`v_*` views** from `supabase/migrations/0023`
(confirmed live by probing — the proposed `0014–0024` schema is as-built despite
the "DO NOT RUN" headers; same finding as the GST/GRN slices):

| Source | Used by |
|---|---|
| `sales_invoices` / `sale_lines` (+ `items`, `ledgers` embeds) | dashboard, sales, tax |
| `purchases` / `purchase_lines` | purchase, tax |
| `payments` | dashboard (collected today) |
| `v_receivables_aging` / `v_payables_aging` | dashboard, financial |
| `v_stock_on_hand` / `v_near_expiry` / `v_dead_stock` | dashboard, inventory |
| `stock_movements` | inventory (movement ledger), financial (COGS) |
| `v_trial_balance` / `v_pnl` / `v_balance_sheet` + `ledger_entries` | financial |
| `drug_licenses` | dashboard (license status) |
| `physical_count_lines` | inventory (count variance) |
| `shops` (via `useOrgShops`) | the cross-shop switcher (SALT-118) |

**No new migrations or RPCs** — the whole module is **pure reads** over the existing
0014–0024 backbone; the `v_*` views live in `supabase/migrations/0023_reports.sql`,
the accounting in `0017`, documents in `0018`–`0019`, inventory in `0016`. Every
query is per-org RLS-scoped (`security_invoker` views), so reports show only the
caller's org.

Two shared libs underpin the suite:

- **`lib/reports.ts`** — pure, smoke-tested aggregation + helpers: `istToday` /
  `monthRange` / `presetRange` (Indian FY-aware), `rollupLines` / `rollupParties` /
  `rollupStock`, `sumAging`, `topItemsSold` / `cashCreditSplit` / `summarizeLicenses`,
  the accounting builders `buildTrialBalance` / `buildPnl` / `buildBalanceSheet`,
  and CSV (`downloadCsv` / `toCsv`).
- **`lib/reportData.ts`** — `fetchAllPaged`, which pages past PostgREST's ~1000-row
  cap (a month register/line pull can exceed it). The page supplies the typed
  `(from,to) => query.range(...)`; the helper loops.

Shared UI: `components/reports/report-controls.tsx` (`ViewTabs` segmented control,
`RangeControls` from/to + presets, `ExportButton`, `ShopSelect`) and
`components/reports/useOrgShops.ts` (`useOrgShops` + `scopeLabelFor`). Tables reuse
the `patterns/` `DataTable` / `StatCard` / `EmptyState`. The six page components
(`DashboardPage`, `Sales/Purchase/Inventory/Financial/TaxReportsPage`) are
route-lazy-loaded in `App.tsx`, so the analytics code never weighs on the cashier
cold-start.

## The suites

| Route | Screen | Views |
|---|---|---|
| `/reports` | `DashboardPage` | live KPIs (today sales + cash/credit, collected, near-expiry value-at-risk, overdue >30d, receivables/payables, license status) + top items today + overdue collections (→ party) |
| `/reports/sales` | `SalesReportsPage` | daily register · item-wise · categories (GST rate + schedule) · customers · cashiers · cancelled |
| `/reports/purchases` | `PurchaseReportsPage` | GRN register · vendor-wise · item-wise · scheme tracking (free goods / scheme notes) |
| `/reports/inventory` | `InventoryReportsPage` | stock on hand · valuation (cost vs MRP + margin) · near-expiry · dead/slow · reorder · movement¹ · count variance¹ |
| `/reports/financial` | `FinancialReportsPage` | receivables/payables aging · P&L¹ (accrual) · balance sheet · trial balance · day/cash/bank book¹ · margin¹ |
| `/reports/tax` | `TaxReportsPage` | GSTR-1/3B summary preview · HSN summary · output by rate · ITC by rate |

¹ Date-range-driven (the range picker shows only for these); other views are
current-state / as-of-now.

## Decisions & limitations

- **Shop switcher (SALT-118):** Dashboard / Sales / Purchase / Inventory / Tax take
  a `ShopSelect` (backed by `useOrgShops`) — **All shops** (org-wide, consolidated;
  the default) or a single shop. It **hides itself for single-shop orgs**, where the
  report already runs org-wide, so there is zero change there. Queries drop the
  `shop_id` filter for "All shops" and re-add it (direct or via the document embed,
  e.g. `sales_invoices.shop_id`) for a single shop. Caveats: receivables/payables
  **aging stays org-wide** (the aging views are party-level, not shop-scoped); the
  consolidated **Tax** view sums across **GSTINs** (a management view, not a filing).
- **Financial reports are organisation-wide**, not shop-scoped — accounting is per
  legal entity (the `v_trial_balance` / `v_pnl` / `v_balance_sheet` views group by
  `org_id` only), so they carry no switcher. Stated in each subtitle.
- **Balance sheet** folds all-time net P&L (`v_pnl`) into equity as "retained
  earnings" so assets ≈ liabilities + equity (the asset/liability/equity view
  excludes income/expense accounts).
- **P&L is accrual** (the ledger expenses purchases when received; periodic, no
  COGS posting). The **margin** view computes true gross margin = posted Sales −
  COGS from `stock_movements.unit_cost_paise`. A cash-basis P&L is future work.
- **Reorder** uses the live per-item **`items.reorder_level`** (confirmed live —
  the column is `reorder_level`, not the `reorder_point` first assumed): items
  at/below their level, **including out-of-stock** (which `v_stock_on_hand` can't
  show, as it filters `qty <> 0`). On-hand is per-shop, reorder level is org-wide.
  Setting the level needs a field in the catalogue item form — **SALT-167**
  (catalogue) narrowed to that.
- **Tax reports preview**; filing (GSTN JSON/CSV, B2B/B2C detail, GSTR-2B match)
  stays in [GST & compliance](gst-returns.md). The tax suite reuses `lib/gst.ts`
  (`buildGstr1` / `buildGstr3b`) and links across.
- **Cashier names** resolve best-effort from `profiles` (RLS may hide non-self
  rows → falls back to a short id).
- Sales returns / credit notes are excluded until the **Returns** module exists
  (noted on the cancelled + tax views).

## Current state vs planned

**Shipped (7 tickets):** the dashboard + all five suites, the cross-shop switcher,
per-view CSV export, and drill-downs (dashboard / register rows → party, invoice,
GRN). Every figure reconciles with the GST module by sharing the operational-basis
filter. lint + build green; the pure helpers in `lib/reports.ts` are smoke-tested
(rollups, aging, IST/FY dates, the trial-balance / P&L / balance-sheet builders incl.
the balance-sheet tie-out).

**Planned / deferred:**
- **Sales-return / credit-note** lines in the registers — await the Returns module
  (the recompute engine [`lib/returns.ts`](returns.md) exists; the report wiring is downstream).
- **Cash-basis P&L** — today's P&L is accrual from the double-entry ledger.
- **GSTR-2B reconciliation** lives in [GST & compliance](gst-returns.md), not here; the tax suite only
  previews GSTR-1/3B and links across.
- **Scheduled / emailed reports** and richer PDF (beyond browser print + CSV) — not built.
- **Reorder** is fully actionable only once the catalogue exposes `items.reorder_level`
  in the item form (**SALT-167**).

## Related
[information-architecture](information-architecture.md) · [gst-returns](gst-returns.md) · [grn](grn.md) · [payments](payments.md) · [data-model](data-model.md) · [product/product-modules](../product/product-modules.md)
