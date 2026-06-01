---
type: architecture
updated: 2026-06-01
tags: [salesman, wholesale, commission, collections, sales]
---

# Salesman management

The field-salesman surface for **wholesale dealers** — module 16 in
[product/product-modules](../product/product-modules.md) (Tier 3, "Differentiate").
A wholesaler like the [wholesale-owner persona](../domain/persona-wholesale-owner.md)
runs salesmen who visit retail chemists, book orders, and collect outstanding.
Salt tracks each salesman, the orders booked under them, the **commission** earned,
and the **collections** they bring in.

Routes (owner-only, nav `g e`):
- `/salesmen` — the master **and** the salesman-wise commission report: one row per
  salesman with their period orders / net sales / commission / collections.
- `/salesmen/:id` — one salesman's detail: period KPIs + their orders and collections,
  with attribution back-fill.

## Data model

Built on tables that already existed in the applied model; this slice adds two columns
(migration **`0039_salesman.sql`**, user-run).

| Table | Column | Source | Meaning |
|---|---|---|---|
| `salesmen` | `id, org_id, name, phone, territory, is_active` | 0024_settings | the master |
| `salesmen` | `source jsonb` | 0030_masters_expansion | verbatim imported row (faithful capture) |
| `salesmen` | **`commission_pct numeric`** | **0039** | commission rate (percent of net sales) |
| `sales_invoices` | `salesman_id → salesmen` | 0024_settings | the order's salesman |
| `payments` | **`salesman_id → salesmen`** | **0039** | who collected the receipt |

All per-org via RLS (`is_member`); `salesman_id` is nullable / `on delete set null`, so
deleting a salesman keeps the history (orders/collections just lose their attribution).

## Commission basis

A salesman's commission for a period is `commission_pct` × **net sales** — the
**GST-exclusive taxable value** (`sales_invoices.taxable_paise`) of their placed
(non-cancelled) invoices, **not** the tax-inclusive gross. MRP in pharma is
tax-inclusive (see [billing-screen](billing-screen.md) / [decisions/0003](../decisions/0003-money-as-paise.md)),
so taxable value is the honest base. Collection-based commission is a future option.

## Where the attribution comes from

The natural capture point is **at billing** (pick the salesman on the bill) and **at
receipt** (who collected) — those screens live in the **billing** and **payments**
modules, so capture there is filed as tickets (SALT-192, SALT-193). Until then — and
for back-filling history — the detail page offers **"Attribute orders / collections"**:
multi-select recent rows with no salesman and set `salesman_id` directly (an RLS-guarded
update; nothing else about the document changes). The performance reads degrade
gracefully if `payments.salesman_id` is absent (0039 unapplied): collections show zero
rather than erroring.

## Code

- **`lib/salesmen.ts`** — the whole data layer: master CRUD (`listSalesmen`,
  `getSalesman`, `saveSalesman`, `deleteSalesman`, `validateDraft`), the period rollup
  (`fetchPerf` — two paged reads grouped in JS, every salesman seeded so idle ones still
  show), detail lists (`listSalesmanInvoices` / `listSalesmanCollections`), and
  attribution (`listUnassigned*` / `assign*`).
- **`components/salesmen/`** — `SalesmenPage` (master + report), `SalesmanDetailPage`
  (drill-down), `SalesmanForm` (shared add/edit dialog), `AttributeDialog` (assign).
- Reuses the reports module's `RangeControls` / `ViewTabs` / `ExportButton`
  ([report-controls](../../apps/web/src/components/reports/report-controls.tsx)) and
  `presetRange` / `downloadCsv` from `lib/reports.ts`.

## Related
[product/product-modules](../product/product-modules.md) ·
[architecture/data-model](data-model.md) ·
[architecture/payments](payments.md) ·
[architecture/reports](reports.md) ·
[architecture/billing-screen](billing-screen.md) ·
[domain/persona-wholesale-owner](../domain/persona-wholesale-owner.md)
