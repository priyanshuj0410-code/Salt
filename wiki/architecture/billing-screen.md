---
type: architecture
updated: 2026-06-01
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

The diagram is the **desktop** grid (`grid-cols-[1fr_320px]`); below `md` the panes stack and the summary
becomes a fixed bottom **`MobileCheckout`** bar. As of PR #42 `BillingScreen.tsx` is a fixed **header →
scrolling content → fixed checkout** shell (`h-full overflow-hidden`). The header is a prominent **customer
bar** (`CustomerBar` — name, phone, `Ctrl K` to change) anchoring the left, with `Counter 1` muted on the
right — **no brand mark or `UserMenu`** (both live in the sidebar). The checkout is one `useCheckout` hook in
two presentations — `BillSummary` (desktop pane) / `MobileCheckout` (mobile bar) — the dual-modality ActionBar
from [interaction-patterns](interaction-patterns.md) (ADR [0015](../decisions/0015-dual-modality-interaction.md)).

Sub-components:

| File | Role |
|---|---|
| `BillingScreen.tsx` | Shell + header `CustomerBar`; holds the single `useCheckout`; fetches selected-customer detail (GSTIN/phone/state_code) |
| `ItemSearch.tsx` | Search input + result dropdown (type-ahead: `↑/↓` + `Enter`) |
| `BillTable.tsx` | Bill lines — dense **table** on desktop, tappable **cards** on mobile; inline qty/discount; `BatchPicker` trigger |
| `BatchPicker.tsx` | Popover for switching a line to a different batch of the same item |
| `useCheckout.ts` | Shared checkout logic: `create_sales_invoice` → **Save & Print** (`F9`), payment, totals, intra/inter-state split, H1 gate + shop-setup rescue (held once) |
| `BillSummary.tsx` | **Desktop** checkout pane: breakdown, payment, GSTIN prompt, **Save & Print · F9** + Save only — presentational (props from `useCheckout`) |
| `MobileCheckout.tsx` | **Mobile** checkout bar: items · payment · total + **Save & Print** (printer + ₹X); taps to expand breakdown/payment/Save only |
| `printInvoice.ts` (`lib/`) | Builds the receipt from live bill + shop + customer and opens a print window — see [Save & Print](#save--print--gst-split) |
| `GstinPrompt.tsx` | Inline "Add GSTIN" when the customer has none — writes `ledgers.gstin` mid-bill, never blocks the sale |
| `CustomerPicker.tsx` | Choose customer (walk-in default); search by name/phone; **Enter picks the top match** |
| `ShortcutHelp.tsx` | Modal reference (Shift+/) |
| `ScheduleBadge.tsx` | H / H1 / X / OTC badge on search results **and bill lines** |
| `H1Gate.tsx` | Schedule H1/X checkout gate dialog + `H1Notice` inline banner — see [Schedule H1/X gate](#schedule-h1x-gate) |

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
| `Ctrl+K` | Anywhere | Open `CustomerPicker` (type → `Enter` picks the top match) |
| `F9` | Anywhere | **Save & Print** the bill → `create_sales_invoice` then print receipt |
| `Shift+/` | Anywhere | Open `ShortcutHelp` dialog |

## Save & Print + GST split

The primary checkout action is **Save & Print** (the desktop `Save & Print · F9` button, the mobile printer+₹ button, and `F9`): it saves via `create_sales_invoice`, then prints a receipt. A secondary **Save only** button writes the bill without printing.

- **Print path** ([`lib/printInvoice.ts`](../../apps/web/src/lib/printInvoice.ts)) is self-contained — `printInvoice(data)` opens a new window with an inline-styled 80mm receipt (shop header from `useAuth().shop`, customer, lines with batch/expiry, totals + the GST split), which auto-prints and closes. No global print CSS or `App.tsx` change, so it stays inside the billing module. The browser dialog covers thermal / A4 / PDF.
- `useCheckout.save({ print })` returns the new invoice id and captures the receipt from live bill state **before** `clear()` wipes it. Print intent is remembered (a `ref`) across the H1 gate / shop-setup detours, so a resumed save still prints; `saveAndPrint` / `saveOnly` set it explicitly.
- **Invoice ref:** until the FY-scoped GST series (**SALT-013**) exists, the printed handle is `invoiceRef(id)` — the first 8 hex of the invoice UUID. **Drug-license no. is not yet on the receipt** (the `drug_licenses` table has no entry UI yet) — follow-up.
- **CGST/SGST vs IGST** is shown at checkout *and* on the receipt via `gstSplit(gst, isInterstate)` (`lib/billing.ts`). `isInterstate` = the bound customer has a `state_code` differing from the shop's (walk-in / no party ⇒ intra-state) — matching the server split in `create_sales_invoice`.

## Schedule H1/X gate

A **hard gate**: a bill containing any Schedule **H1** or **X** drug cannot be saved until the prescriber + patient are recorded (Drugs & Cosmetics Rules — the H1 register; plain Schedule H needs a prescription but no register, so it is **not** gated). Implemented client-side in [`useCheckout.ts`](../../apps/web/src/components/billing/useCheckout.ts), so it covers every checkout entry point (F9, desktop **Save**, mobile **Charge**) from one guard.

- `requiresRx(lines)` / `gatedLines(lines)` (`lib/billing.ts`) decide if the gate fires and which lines triggered it. Gated schedules: `GATED_SCHEDULES = ["H1","X"]`, mirroring the server `record_h1_entry` / `enforce_h1_gate` contract (0022).
- On save, if the bill needs Rx and none is captured, `save()` opens **`H1Gate`** instead of writing. The dialog requires **doctor name, patient name, patient address** (doctor reg. no. optional) — the same three the server function mandates.
- Captured details live on the bill store (`useBill.rx`), so `clear()` resets them after a save / manual clear — one customer's prescription never carries to the next bill.
- Persistence **today**: `buildSalesInvoicePayload` threads the details into the existing `create_sales_invoice` args — `doctorName → sales_invoices.doctor_name`, the rest formatted by `formatRxNote` into `notes`. Only attached when the bill actually has H1/X lines.
- `H1Notice` (amber → green) surfaces the requirement inline above Save/Charge and opens the gate to add/edit.

**Follow-up (DB slice, not built here):** wire `enforce_h1_gate` + `record_h1_entry` into `create_sales_invoice` so the structured `h1_register` rows are written atomically (with real `sale_line_id`s) and the server independently rejects a non-compliant H1 sale — defense in depth behind this UI gate. The proposed RPC (`supabase/proposed/0018_sales.sql`) already carries `doctor_name`/`notes` but does **not** call the gate; see ticket SALT-148 (and SALT-065 for the inspector register screen).

## useBill store (`store/bill.ts`)

Zustand store managing all mutable bill state.

**State shape:**
```ts
lines: BillLine[]
payment: { method: "cash" | "credit"; creditDays: number }
party: OrderParty | null   // the customer; null = walk-in
rx: RxDetails | null        // captured Schedule H1/X prescription; cleared by clear()
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
