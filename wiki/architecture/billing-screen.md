---
type: architecture
updated: 2026-05-29
---

# Billing screen

The counter billing screen (`apps/web/src/components/billing/`) is the core revenue surface of Salt. It is the only screen reachable by cashiers (the default `/` route). See [screens-routing](screens-routing.md) for access rules.

## Layout

Three-pane grid rendered by `BillingScreen.tsx`:

```
┌──────────────────────────────────┬──────────────┐
│ ItemSearch                       │              │
├──────────────────────────────────┤ BillSummary  │
│ BillTable                        │  (sidebar)   │
└──────────────────────────────────┴──────────────┘
```

CSS: `grid-cols-[1fr_320px]`. A header bar (invoice number, walk-in label, `UserMenu`) and a footer hint bar bracket the main grid.

Sub-components:

| File | Role |
|---|---|
| `ItemSearch.tsx` | Search input + result dropdown |
| `BillTable.tsx` | Scrollable table of bill lines; inline qty/discount inputs; `BatchPicker` trigger |
| `BatchPicker.tsx` | Popover for switching a line to a different batch of the same item |
| `BillSummary.tsx` | Sidebar: totals, payment method picker, credit-days selector, print button |
| `ShortcutHelp.tsx` | Modal reference (Shift+/) |
| `ScheduleBadge.tsx` | H / H1 / X / OTC badge on search results |

## Keyboard map

| Key | Context | Action |
|---|---|---|
| Any character | `ItemSearch` | Filter catalog (name / salt / manufacturer / HSN / barcode) |
| `↑` / `↓` | `ItemSearch` | Move highlight through results |
| `Enter` | `ItemSearch` | Add highlighted item (FEFO batch) to bill |
| `Esc` | `ItemSearch` | Clear query |
| `↓` | Empty search box | Jump focus to first bill row |
| `↑` / `↓` | Bill row focused | Navigate between rows |
| `=` or `+` | Bill row focused | Increment qty by 1 |
| `−` | Bill row focused | Decrement qty by 1 (floor 1) |
| `Del` / `Backspace` | Bill row focused | Remove line |
| `Tab` | Bill row focused | Move into qty / discount inline inputs |
| `Shift+/` | Anywhere | Open `ShortcutHelp` dialog |

## useBill store (`store/bill.ts`)

Zustand store managing all mutable bill state.

**State shape:**
```ts
lines: BillLine[]
payment: { method: "cash" | "credit"; creditDays: number }
```

**Actions:**
- `addItem(item, batchNo?)` — selects FEFO batch if `batchNo` is omitted; merges qty into an existing line for the same key; no-op if no stock remains
- `setQty(key, qty)` — updates qty, enforces per-item stock cap via `lineMaxQty()`; removes line if qty ≤ 0
- `setBatch(key, item, batch)` — re-keys the line to `itemId:newBatchNo`; if that key already exists, merges qty (capped by stock) and drops the old line
- `setDiscount(key, type, value)` — `"pct"` (0–100) or `"flat"` (paise, capped at line gross)
- `removeLine(key)`, `setPaymentMethod()`, `setCreditDays()`, `clear()`

**Line key:** `itemId:batchNo` — stable across qty changes, changes only when the batch is swapped.

`billTotals(lines)` is a pure function (not stored in Zustand):
```
{ items, qty, gross, discount, taxable, gst, grand, cost, margin }
```
GST is MRP-inclusive (per [decisions/0003-money-as-paise.md](../decisions/0003-money-as-paise.md)). `splitInclusiveGst(lineNet, gstRate)` back-calculates taxable and gst from the post-discount net amount.

## useCatalog store (`store/catalog.ts`)

Zustand store. Loaded once per org on `BillingScreen` mount — read-only after that (no mutations).

- Fetches `items` + `batches` in parallel from Supabase; groups batches by item
- If the org has zero items, falls back to `seedCatalog` (demo data); `usingSeed: true` is set so the UI can show an "import your data" prompt

## Search algorithm (`lib/search.ts`)

Single text query matched across five fields with per-field weights:

| Field | Weight |
|---|---|
| name | 1.0 |
| barcode | 1.0 |
| salt | 0.9 |
| manufacturer | 0.6 |
| hsn | 0.5 |

Match strength per field (`fieldScore`):

| Match type | Score |
|---|---|
| Exact | 100 |
| Starts-with | 70 |
| Contains | 40 |
| Subsequence | 15 |
| No match | 0 |

`finalScore = max(weight × fieldScore)` across all fields. Results sorted: **in-stock first**, then score descending, then sales velocity descending. Capped at `MAX_RESULTS = 8`.

If the highlighted result has no stock and a same-salt substitute exists in-stock, pressing `Enter` adds the substitute.

## FEFO (`lib/search.ts: fefoBatch`)

Filters batches to those with `qty > 0`, sorts by `expiry` string lexicographically (`YYYY-MM` or `YYYY-MM-DD` compare correctly as strings), returns the first. Used by `addItem` when no `batchNo` is specified.

## Stock cap (`lib/billing.ts: lineMaxQty`)

```
lineMaxQty = item.stock − sumItemQty(lines, itemId, [thisLineKey])
```

Stock is capped **per item** across all its batches combined. Adding a second batch for the same item reduces available qty for both lines.

## Related
[screens-routing](screens-routing.md) · [domain/medical-retail](../domain/medical-retail.md) · [decisions/0003-money-as-paise](../decisions/0003-money-as-paise.md)
