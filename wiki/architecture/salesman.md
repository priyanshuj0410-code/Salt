---
type: architecture
updated: 2026-06-02
tags: [salesman, wholesale, commission, collections, sales]
---

# Salesman management

The field-salesman surface for **wholesale dealers** — module 16 in
[product/product-modules](../product/product-modules.md) (Tier 3, "Differentiate").
A wholesaler like the [wholesale-owner persona](../domain/persona-wholesale-owner.md)
runs salesmen who visit retail chemists, book orders, and collect outstanding. Salt
tracks each salesman, the orders booked under them, the **commission** earned, and the
**collections** they bring in. Shipped in **SALT-128**; owner-only, nav `g e`.

---

## Screens & flows

Both screens are lazy-loaded, owner-gated routes (`App.tsx` → `components/salesmen/`).
Both hang their period off the reports module's `RangeControls` (presets Today / This
month / Last month / This FY) and export their current table to CSV.

### `/salesmen` — master + commission report (SALT-128)

`SalesmenPage`. One table, **one row per salesman**, doubling as the master and the
salesman-wise commission report:

- Four `StatCard`s sum the period: **orders**, **net sales**, **commission**, **collections**.
- Each row: name (+ territory · phone), commission %, and the salesman's period **orders /
  net sales / commission / collections**. Inactive salesmen sort last with a neutral badge.
- **Add salesman** (and row-click → edit) opens `SalesmanForm` in a dialog — name, mobile,
  territory, commission %, active. Validate → insert/update; arm-then-confirm delete.
- Row click navigates to the detail page; **CSV** export of the whole roster + metrics.

### `/salesmen/:id` — one salesman (SALT-128)

`SalesmanDetailPage`. Header shows name / territory / phone / commission % (+ an *Inactive*
badge), with **Edit** (same `SalesmanForm`; a delete bounces back to the list). Below:

- Four `StatCard`s — **orders** (placed invoices), **net sales**, **commission due**
  (`commission_pct` of net sales), **collections**.
- A `ViewTabs` toggle between **Orders** (invoice no / date / party / status / net / total)
  and **Collections** (date / party / mode / reference / amount), each its own `DataTable`
  + CSV.
- **Attribute orders / collections** (`AttributeDialog`): multi-select recent rows that
  have no salesman and assign them to this one (see *attribution* below).

---

## Data model

Built on tables already in the applied model; this slice adds **two columns** (migration
**`0039_salesman.sql`**, user-run — additive + idempotent, no RPC).

| Table | Column | Source | Meaning |
|---|---|---|---|
| `salesmen` | `id, org_id, name, phone, territory, is_active` | `0024_settings` | the master |
| `salesmen` | `source jsonb` | `0030_masters_expansion` | verbatim imported row (faithful capture) |
| `salesmen` | **`commission_pct numeric`** | **`0039`** | commission rate (percent of net sales) |
| `sales_invoices` | `salesman_id → salesmen` | `0024_settings` | the order's salesman |
| `payments` | **`salesman_id → salesmen`** | **`0039`** | who collected the receipt |

All per-org via RLS (`is_member`). Both `salesman_id` FKs are nullable / `on delete set
null`, so deleting a salesman keeps the order/collection history — the rows just lose their
attribution. No new RPC: reads go straight through PostgREST under RLS; writes are plain
inserts/updates. See [architecture/data-model](data-model.md) ·
[architecture/security-rls](security-rls.md).

---

## Commission & attribution

**Commission basis.** A salesman's commission for a period is `commission_pct` × **net
sales** — the **GST-exclusive taxable value** (`sales_invoices.taxable_paise`) of their
**placed** (non-cancelled) invoices, *not* the tax-inclusive gross. MRP in pharma is
tax-inclusive (see [billing-screen](billing-screen.md) /
[decisions/0003](../decisions/0003-money-as-paise.md)), so taxable value is the honest base.

**Where attribution comes from.** The natural capture point is **at billing** (pick the
salesman on the bill) and **at receipt** (who collected) — those screens live in the
**billing** and **payments** modules, so capture there is filed as **SALT-192** (billing)
and **SALT-193** (payments). Until then — and to back-fill history — the detail page's
**Attribute** dialog sets `salesman_id` directly on recent unattributed rows (an RLS-guarded
`update`; nothing else about the document changes).

**Data layer — `lib/salesmen.ts`.** The whole module's data access:
- master CRUD: `listSalesmen`, `getSalesman`, `saveSalesman`, `deleteSalesman`, `validateDraft`
- period rollup: **`fetchPerf`** — two paged reads (invoices + received payments via
  `fetchAllPaged`) grouped in JS; every salesman is seeded so idle ones still render zeroed
- detail lists: `listSalesmanInvoices` / `listSalesmanCollections`
- attribution: `listUnassignedInvoices` / `listUnassignedPayments` + `assignInvoices` / `assignPayments`

Reuses the **reports** module's `RangeControls` / `ViewTabs` / `ExportButton`
([report-controls](../../apps/web/src/components/reports/report-controls.tsx)) and
`presetRange` / `downloadCsv` / `paiseToRupeeStr` from `lib/reports.ts` (cross-module import,
not a fork).

---

## Key decisions & gotchas

### Commission is on net (ex-GST) value, not MRP gross
Computed from `taxable_paise`, so a salesman's commission doesn't inflate with the GST the
shop merely collects and remits. Collection-based commission (pay on what's *collected*, to
push recovery) is a deliberate future option, not the default.

### Attribution is a back-fill; capture-at-source is out of module
The salesman module owns the **master + reads + back-fill** only. Writing `salesman_id` at
the moment a bill/receipt is created means editing `create_sales_invoice` / `record_payment`
and the billing/payments screens — other modules' files — so it's filed as tickets, not
done here. The board confirmed the handoff: the payments lane is already on
`salt-193-salesman-receipt`.

### Collections degrade, never error
`payments.salesman_id` only exists once `0039` is applied. `fetchPerf` and
`listSalesmanCollections` wrap the payments read in try/catch and fall back to **zero
collections** if the column is missing, so the orders/commission view still works pre-migration.

### Migration numbering — verify the real max
Shipped as **`0039_salesman.sql`**. It was first authored as `0032` because the lane had
been branched off a **stale `origin/main`** (max migration looked like `0031`); true main was
already at `0038` with several parallel `0032_*.sql`. Renumbered before merge. Always check
`git ls-tree origin/main supabase/migrations/` for the true max before numbering.

### `set-state-in-effect` lint rule
Salt's ESLint blocks synchronous `setState` in a `useEffect` body; the load effects put
`setLoading(true)` / `setError(null)` **inside** the async IIFE and guard writes with an
`active` flag (the repo-wide pattern, mirrored from the reports pages).

---

## Current state vs planned

**Built (SALT-128):**
- `salesmen` master CRUD (name, mobile, territory, commission %, active).
- Period rollup → salesman-wise **orders / net sales / commission / collections**, on both
  the roster and per-salesman, with CSV export.
- **Attribution** back-fill for existing orders and collections.

**Planned / gaps:**
- **Capture-at-source**: salesman on the bill (**SALT-192**) + collector on the receipt
  (**SALT-193**) — turns the reports from back-fill into live capture.
- Collection-based commission and **commission payout/settlement** (post a payable + clear it).
- Salesman **targets / incentive slabs** and territory-wise analytics.
- A salesman **role / field login** (today the module is owner-only management).

---

## Related pages
[product/product-modules](../product/product-modules.md) ·
[architecture/data-model](data-model.md) ·
[architecture/security-rls](security-rls.md) ·
[architecture/payments](payments.md) ·
[architecture/reports](reports.md) ·
[architecture/billing-screen](billing-screen.md) ·
[domain/persona-wholesale-owner](../domain/persona-wholesale-owner.md)
