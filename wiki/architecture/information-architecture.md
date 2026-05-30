---
type: architecture
updated: 2026-05-29
tags: [ux, navigation, keyboard, ia]
---

# Information architecture

The complete navigation model, screen inventory, keyboard system, and user journey flows for Salt. Designed for a keyboard-first wholesale dealer (see [persona](../domain/persona-wholesale-owner.md)) running 3–5 counters on unreliable internet.

---

## Design principles

1. **Counter is home.** Billing is the highest-frequency action. It is the default landing screen for cashiers and reachable from anywhere in one keystroke.
2. **Two-keystroke navigation.** Any top-level module is reachable from anywhere via `G` + letter. No deep menu trees.
3. **`N` always means New.** On any list screen, `N` creates a new item in that context. Consistent, predictable.
4. **`Esc` always goes back.** Close modal → back to detail → back to list → back to previous module. No dead ends.
5. **`/` searches the current screen.** On any list, `/` focuses the search/filter bar. `Ctrl+K` is the global command palette.
6. **Forms are Tab-complete.** Every form field is reachable by `Tab`/`Shift+Tab`. No mandatory mouse clicks. `Ctrl+S` saves from anywhere in a form.
7. **Role-aware navigation.** Cashier sees only Counter. Owner sees everything. The sidebar shrinks to what the user can actually act on.

---

## Navigation tree

```
SALT
├── [C] Counter              ← default for all roles; always reachable via G C
│   ├── Active Bill          (default sub-view)
│   └── Bill History         /bills          (G C H or just /bills)
│
├── [P] Purchases            /purchases      owner only
│   ├── GRN — Receive Stock  /purchases/new  (N from Purchases)
│   ├── GRN History          /purchases
│   ├── Debit Notes          /purchases/returns
│   └── Purchase Orders      /purchases/orders   (future)
│
├── [S] Sales                /bills          owner only (cashier sees only own bills)
│   ├── Invoices             /bills
│   ├── Credit Notes         /bills/returns
│   └── H1 / X Register      /compliance/h1
│
├── [I] Inventory            /inventory      owner only
│   ├── Stock Ledger         /inventory
│   ├── Near Expiry          /inventory/expiry
│   ├── Dead / Slow Stock    /inventory/dead
│   └── Physical Count       /inventory/count
│
├── [A] Parties              /parties        owner only
│   ├── Customers            /parties?type=customer
│   ├── Vendors              /parties?type=vendor
│   └── Party Profile        /parties/:id
│
├── [M] Payments             /payments       owner only
│   ├── Receive Payment      /payments/receive  (N → receive)
│   ├── Make Payment         /payments/pay      (N → pay)
│   └── Bank Reconciliation  /payments/bank-rec
│
├── [T] GST & Compliance     /gst            owner/accountant only
│   ├── GSTR-1               /gst/gstr1
│   ├── GSTR-3B              /gst/gstr3b
│   ├── GSTR-2B Recon        /gst/recon
│   ├── ITC Register         /gst/itc
│   ├── H1 / X Register      /gst/h1
│   └── Drug Licenses        /gst/licenses
│
├── [R] Reports              /reports        owner/accountant only
│   ├── Dashboard            /reports        (default sub-view)
│   ├── Sales Reports        /reports/sales
│   ├── Purchase Reports     /reports/purchases
│   ├── Inventory Reports    /reports/inventory
│   └── Financial Reports    /reports/financial
│
├── [K] Catalogue            /catalogue      owner only
│   ├── Items                /catalogue
│   └── Item Detail / Edit   /catalogue/:id
│
└── [,] Settings             /settings       owner only
    ├── Users & Roles        /settings/users
    ├── Organisation         /settings/org
    ├── Drug Licenses        /settings/licenses
    ├── Print Templates      /settings/print
    └── Import / Migration   /import  (existing)
```

---

## Keyboard shortcut system

### Navigation (`G` + letter — from anywhere)

| Keys | Destination |
|---|---|
| `G C` | Counter / Billing |
| `G P` | Purchases |
| `G S` | Sales / Bill History |
| `G I` | Inventory |
| `G A` | Parties |
| `G M` | Payments |
| `G T` | GST & Compliance |
| `G R` | Reports / Dashboard |
| `G K` | Catalogue |
| `G ,` | Settings |

`G` alone opens a visual "go to" overlay showing all shortcuts — helpful for new users.

### Global (always active)

| Key | Action |
|---|---|
| `Ctrl+K` | Global command palette — search parties, items, actions, navigate |
| `?` | Show keyboard shortcuts for current screen |
| `Esc` | Back / close modal / cancel form |
| `Ctrl+Z` | Undo (where applicable) |

### List screens (Purchases, Sales, Inventory, Parties, etc.)

| Key | Action |
|---|---|
| `N` | New item (new GRN, new payment, new credit note…) |
| `/` | Focus search/filter bar |
| `↑` / `↓` | Navigate rows |
| `Enter` | Open selected row |
| `E` | Edit selected row |
| `Ctrl+E` | Export current view (CSV or PDF) |
| `Ctrl+P` | Print current view |
| `1`–`5` | Switch between sub-tabs within current module |

### Form screens (GRN entry, payment, credit note…)

| Key | Action |
|---|---|
| `Tab` | Next field |
| `Shift+Tab` | Previous field |
| `Enter` | Confirm current field / add line (in line-item tables) |
| `Ctrl+S` | Save form |
| `Esc` | Cancel (prompt if unsaved changes) |

### Counter / Billing (extends the existing billing screen shortcuts)

| Key | Action |
|---|---|
| type | Search items (name / salt / manufacturer / barcode) |
| `↑` / `↓` | Navigate search results or bill rows |
| `Enter` | Add highlighted item (FEFO batch) |
| `Esc` | Clear search |
| `=` / `+` | Increment qty on focused row |
| `−` | Decrement qty (floor 1) |
| `Del` | Remove focused row |
| `Tab` | Move into qty / discount inputs |
| `Ctrl+K` | Open customer picker (default: Walk-in) |
| `F9` | Save bill → `place_order` |
| `Ctrl+P` | Print last saved bill |
| `Shift+/` | Show shortcut help |

---

## Screen inventory

Every screen, its purpose, and its primary keyboard actions.

### Counter — Active Bill (`/`)

**Purpose:** Compose and save a sale. The speed-critical surface; default landing for cashiers.
**Owner of state:** `useBill` Zustand store.
**Primary actions:** add item (`Enter`), adjust qty (`=` / `−`), remove (`Del`), pick customer (`Ctrl+K`), save (`F9`), print (`Ctrl+P`).
**Exit points:** `F9` saves and clears; `G [anything]` navigates away (bill persists in store until saved or cleared).

### Counter — Bill History (`/bills`)

**Purpose:** Browse all saved sale invoices for this org, newest first.
**Primary actions:** search by party/item/date (`/`), open invoice detail (`Enter`), export (`Ctrl+E`).
**Note:** Cashiers see only their own bills; owners see all.

---

### Purchases — GRN List (`/purchases`)

**Purpose:** All goods receipts from vendors. Entry point for stock intake.
**Primary actions:** `N` → new GRN form, search (`/`), open GRN detail (`Enter`).

### Purchases — New GRN (`/purchases/new`)

**Purpose:** Record arrival of stock from a distributor. The foundational write path for inventory, payables, and ITC.
**Form fields:**
- Header: vendor (type-to-search), vendor invoice no., vendor invoice date
- Lines (one row per SKU): item (type-to-search), batch no., expiry, qty received, qty free (scheme), MRP, PTR, trade disc %, GST rate
- Footer: totals computed (taxable, GST, grand total)
**Primary actions:** `Tab` through each field; `Enter` at end of line adds next line; `Ctrl+S` saves GRN.
**Post-save:** stock incremented, payable created on vendor ledger, ITC recorded per line.

### Purchases — GRN Detail (`/purchases/:id`)

**Purpose:** Review a single GRN; initiate return.
**Primary actions:** `N` or `R` → raise debit note / purchase return against this GRN.

### Purchases — Debit Notes (`/purchases/returns`)

**Purpose:** Manage purchase returns (near-expiry, damaged, wrong goods) and associated debit notes to vendors.

---

### Sales — Invoices (`/bills`)

**Purpose:** Full invoice history. Identical route to Counter bill history — same data, owner gets more filters.
**Primary actions:** search (`/`), open detail (`Enter`), `R` → raise credit note against selected invoice.

### Sales — Invoice Detail (`/bills/:id`)

**Purpose:** View a single invoice's lines, GST breakdown, payment status. Print or WhatsApp share.
**Primary actions:** `Ctrl+P` print, `W` WhatsApp share, `R` credit note.

### Sales — Credit Notes (`/bills/returns`)

**Purpose:** Record sales returns — customer brings back stock. Re-stocks batch, reduces customer receivable.

### Sales — H1 / X Register (`/gst/h1`)

**Purpose:** Auditable log of every Schedule H1 and X drug sale. Mandatory 3-year retention; inspector-ready export.
**Primary actions:** filter by date range, `Ctrl+E` → export PDF.

---

### Inventory — Stock Ledger (`/inventory`)

**Purpose:** Current stock levels by item × batch. The owner's "what do I have" view.
**Primary actions:** search by item name / salt (`/`), view batch detail (`Enter`), trigger expiry return (`E` on a near-expiry batch).

### Inventory — Near Expiry (`/inventory/expiry`)

**Purpose:** Batches expiring within 30 / 60 / 90 days (configurable), ranked by days-remaining × MRP-value-at-risk. The highest-value items at the top.
**Colour coding:** red < 30 days · amber 30–60 · yellow 60–90.
**Primary actions:** `R` on a row → initiate return-to-supplier (creates debit note, opens vendor assignment modal).

### Inventory — Dead / Slow Stock (`/inventory/dead`)

**Purpose:** Items with zero (or < threshold) sales in last 90 / 180 days. Actionable: mark for promotion or return.

### Inventory — Physical Count (`/inventory/count`)

**Purpose:** Enter a physical count; system shows variance against book stock; owner approves adjustments.

---

### Parties — List (`/parties`)

**Purpose:** All customers and vendors. Filter tabs: All / Customers / Vendors. Existing screen — needs credit-limit and aging columns added.
**Primary actions:** search (`/`), open profile (`Enter`), `N` → add new party.

### Parties — Profile (`/parties/:id`)

**Purpose:** The single-party command centre. Everything about one counterparty in one place.

**Layout — three tabs:**

```
┌──────────────────────────────────────────────────────────┐
│  Ramesh Medical Stores                  [Customer] [Edit] │
│  GSTIN: 09AAACR123...  Phone: 94105...                   │
│  Credit limit: ₹50,000   Outstanding: ₹38,500  (77%)    │
├──────────────────────────────────────────────────────────┤
│  [1] Outstanding  [2] History  [3] Details               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Tab 1 — Outstanding:                                    │
│  Open invoices with aging: 0–30 / 31–60 / 61–90 / 90+   │
│  Action: P → Record Payment  W → WhatsApp reminder       │
│                                                          │
│  Tab 2 — History:                                        │
│  All orders + payments + credit/debit notes chronological│
│                                                          │
│  Tab 3 — Details:                                        │
│  Address, GSTIN, contact, credit limit, payment terms    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Primary actions:** `P` → record payment, `W` → WhatsApp statement, `N` → new invoice for this party (jumps to Counter with party pre-selected), `1`/`2`/`3` → switch tabs.

---

### Payments — Receive Payment (`/payments/receive`)

**Purpose:** Record cash / UPI / cheque received from a customer; apply against their open invoices.
**Form:** party (type-to-search), amount, mode, reference no., date → open invoices shown → select which to clear (auto-apply oldest-first, or manual).
**Post-save:** customer's outstanding decremented.

### Payments — Make Payment (`/payments/pay`)

**Purpose:** Record payment made to a vendor; apply against open GRN invoices.

### Payments — Bank Reconciliation (`/payments/bank-rec`)

**Purpose:** Import bank statement (CSV); auto-match against recorded payments; flag unmatched lines.

---

### GST — GSTR-1 (`/gst/gstr1`)

**Purpose:** Review all outward supplies for the selected month; export GSTN-compatible JSON for portal upload.
**Layout:** month selector → invoice list (B2B itemised + B2C aggregate) → HSN-wise summary → export JSON button.
**Primary actions:** `1`/`2`/`3` → switch between invoice list / HSN summary / credit notes; `Ctrl+E` → export JSON.

### GST — GSTR-3B (`/gst/gstr3b`)

**Purpose:** Compute the monthly self-assessed summary: outward liability, ITC claimed, ITC reversals, net payable.
**Layout:** auto-computed from sales + GRNs + returns; override fields for manual adjustments; export.

### GST — GSTR-2B Reconciliation (`/gst/recon`)

**Purpose:** The accountant's monthly reconciliation — auto-match GSTR-2B (imported from portal) against local GRN entries.

**Layout — two-column:**
```
┌─────────────────────────┬─────────────────────────┐
│  GSTR-2B (portal)       │  Local GRN entries       │
│                         │                          │
│  Cipla — INV/123        │  ✅ Matched              │
│  Sun Pharma — INV/456   │  ⚠️  Amount mismatch     │
│  Mankind — INV/789      │  ❌ Not found locally    │
│  [local GRN 0042]       │  ❌ Not in GSTR-2B       │
└─────────────────────────┴─────────────────────────┘
  Actions: Accept  |  Reject  |  Flag for follow-up
```
**Primary actions:** `↑↓` navigate rows, `A` accept match, `X` reject, `F` flag.

### GST — ITC Register (`/gst/itc`)

**Purpose:** Batch-level ITC ledger — GST paid on each purchase batch, reversals made, net claimable.

### GST — H1 / X Register (`/gst/h1`)

**Purpose:** Inspector-ready log of every H1 and X drug sale. Filter by date range, drug, or pharmacist. Export PDF with one keystroke (`Ctrl+E`).

### GST — Drug Licenses (`/gst/licenses`)

**Purpose:** Store drug license numbers with expiry dates; surface renewal alerts at 90 / 60 / 30 days.

---

### Reports — Owner Dashboard (`/reports`)

**Purpose:** The first screen the owner wants to see each morning. Live numbers, not historical reports.

**Layout:**
```
┌────────────────┬────────────────┬────────────────┬────────────────┐
│  Today's Sales │  Cash Collected│ Overdue (>30d) │  Near Expiry   │
│  ₹1,24,500     │  ₹68,000       │  ₹3,42,000     │  12 batches    │
│  42 invoices   │  18 payments   │  23 parties     │  ₹89,000 risk  │
└────────────────┴────────────────┴────────────────┴────────────────┘
│  Top items sold today          │  Upcoming payables (next 7 days) │
│  1. Augmentin 625 — 340 strips │  Sun Pharma     ₹45,000  3 days  │
│  2. Pan D — 210 strips         │  Cipla          ₹28,500  5 days  │
│  3. Azithral 500 — 180 strips  │  Mankind        ₹19,000  7 days  │
└────────────────────────────────┴──────────────────────────────────┘
```
**Primary actions:** click/`Enter` on any card → drills into the underlying report or list.

### Reports — Sales / Purchase / Inventory / Financial

Standard report screens with: date-range picker, filters, table view, `Ctrl+E` export (CSV + PDF).

---

### Catalogue — Items (`/catalogue`)

**Purpose:** Browse, search, and edit the full item master. Add new items. View batch history per item.
**Primary actions:** `N` → add item, `/` → search (name / salt / HSN / barcode), `Enter` → item detail.

### Catalogue — Item Detail (`/catalogue/:id`)

**Purpose:** All attributes of one item. Tabs: Details (name, salt, pack, HSN, GST, schedule) / Batches (current stock by batch) / Price History.
**Primary actions:** `E` → edit, `B` → view batches.

---

### Settings

Standard form-based settings screens. Least-frequent access; no special keyboard flow required beyond Tab navigation and `Ctrl+S`.

---

## Role-based navigation

| Module | Owner | Cashier | Accountant | Pharmacist |
|---|---|---|---|---|
| Counter | ✅ | ✅ | — | ✅ |
| Bill History | ✅ (all) | ✅ (own) | ✅ | ✅ (own) |
| Purchases / GRN | ✅ | — | ✅ (read) | — |
| Inventory | ✅ | — | — | ✅ (read) |
| Parties | ✅ | — | ✅ | — |
| Payments | ✅ | — | ✅ | — |
| GST & Compliance | ✅ | — | ✅ | — |
| Reports | ✅ | — | ✅ | — |
| Catalogue | ✅ | ✅ (read) | — | ✅ (read) |
| Settings | ✅ | — | — | — |

Cashier sidebar: Counter only. Pharmacist sidebar: Counter + read-only Inventory + Catalogue. Accountant sidebar: all except Counter and Settings.

---

## Key user journey flows

### Journey 1 — Morning opening (owner, 8 AM)

```
Open app
  → [R] Reports / Dashboard        G R
  → Review: today vs yesterday, overdue receivables, near-expiry count
  → Click overdue card              → Parties list filtered to overdue
  → Select top 3 overdue parties   Enter → Party Profile
  → Send WhatsApp reminder          W  (one keystroke per party)
  → Back to Dashboard               Esc
```

**Time target:** < 5 minutes.

---

### Journey 2 — Receive stock from distributor (GRN entry)

```
Distributor arrives with challan
  → G P                             → Purchases
  → N                               → New GRN form
  → Type vendor name                Tab  (auto-complete)
  → Enter vendor invoice no.        Tab
  → Enter invoice date              Tab  (default: today)
  → Line 1: type item name          Tab → batch no → Tab → expiry
            → Tab → qty received   → Tab → qty free (scheme)
            → Tab → MRP            → Tab → PTR
            → Tab → disc %         → Tab → GST rate → Enter → next line
  → Repeat for each item
  → Review totals (server-computed)
  → Ctrl+S                          → GRN saved; stock incremented; payable created
```

**Time target:** 2–3 minutes per 10-line GRN once familiar.

---

### Journey 3 — Counter billing (peak hours, cashier)

```
App opens → Counter (default)

  → Type drug name                  → results appear
  → ↓ to highlight correct item    → Enter → added at FEFO batch
  → Tab → qty → type qty           → Enter → next item
  → Repeat for all lines

  Walk-in (cash):
  → F9                              → place_order; bill saved, stock decremented, print

  Named customer on credit:
  → Ctrl+K                          → customer picker opens
  → type customer name              → Enter → customer bound to bill
  → F9                              → place_order; credit order created, due_date set
  → Ctrl+P                          → print invoice

  H1 drug in order:
  → Enter adds item → H1 modal opens automatically
  → Tab through: doctor name → patient name → address → Enter
  → Resumes normal billing flow

Counter is now clear → ready for next customer
```

**Time target:** < 5 minutes for a 20-line order.

---

### Journey 4 — Customer pays (afternoon)

```
Customer walks in with cash / shows UPI
  → G A                             → Parties
  → / → type customer name         → Enter → Party Profile
  → Tab 1: Outstanding (default)   → see open invoices + total due
  → P                               → Receive Payment form opens (party pre-filled)
  → Enter amount                   Tab
  → Select mode (cash/UPI/cheque)  Tab
  → Enter reference (if UPI/cheque) Tab
  → Open invoices shown             → auto-apply oldest-first (or select manually)
  → Ctrl+S                          → payment recorded, outstanding updated
  → W                               → WhatsApp receipt sent to customer's number
```

**Time target:** < 2 minutes.

---

### Journey 5 — Near-expiry batch return to supplier

```
  → G I                             → Inventory
  → 2 (Near Expiry tab)
  → Sort by value-at-risk (default)
  → Select batch                   Enter → batch detail
  → R                               → Debit Note form, pre-filled with batch + vendor
  → Confirm qty being returned      Tab → adjust if partial
  → Ctrl+S                          → debit note created, stock decremented, payable reduced
                                      ITC reversal amount pre-computed, feeds GSTR-3B
  → W                               → WhatsApp debit note to vendor rep
```

---

### Journey 6 — Monthly GST filing (accountant, first week of month)

```
  → G T                             → GST & Compliance
  → Select month (default: last month)

  Step 1 — GSTR-2B reconciliation:
  → 3 (GSTR-2B Recon tab)
  → Import GSTR-2B JSON from GST portal (drag-drop or file picker)
  → Auto-match runs
  → ↓ through mismatches: A accept / X reject / F flag for follow-up
  → Ctrl+S → reconciliation saved

  Step 2 — GSTR-1 export:
  → 1 (GSTR-1 tab)
  → Review invoice list (HSN summary auto-computed)
  → Ctrl+E → download JSON → upload to GSTN portal

  Step 3 — GSTR-3B:
  → 2 (GSTR-3B tab)
  → Review computed values (ITC from reconciled GRNs, reversals from returns)
  → Adjust if needed → Ctrl+E → download / enter on portal
```

**Time target:** 2–3 hours (down from 2–4 accountant-days with manual Excel).

---

### Journey 7 — Drug inspector visits

```
Inspector arrives with notice
  → G T                             → GST & Compliance
  → 5 (H1 Register tab)
  → Set date range (last 12 months)
  → Ctrl+E                          → export PDF (formatted for inspector)
                                      opens in print dialog → print or share
  → Switch to Drug Licenses tab
  → Confirm all licenses current    (no red banners = compliant)
  → G S                             → Sales
  → / → search for any specific     → drill into invoice detail if asked
    batch or invoice the inspector
    names
```

**Time target:** < 5 minutes from inspector walking in to handing over the register.

---

## Command palette entries

`Ctrl+K` from anywhere opens the global palette. Default entries:

- Recent parties (last 5 accessed)
- Recent items (last 5 billed)
- **Actions:** "New GRN", "Receive payment", "Generate GSTR-1", "H1 register", "Near expiry report"
- **Navigate:** all top-level modules by name
- **Search:** any party name, item name, invoice number — shows inline results

---

## URL structure

```
/                       Counter (billing)
/bills                  Sale invoice history
/bills/:id              Invoice detail
/bills/returns          Credit notes

/purchases              GRN history
/purchases/new          New GRN
/purchases/:id          GRN detail
/purchases/returns      Debit notes

/inventory              Stock ledger
/inventory/expiry       Near expiry
/inventory/dead         Dead / slow stock
/inventory/count        Physical count

/parties                Party list (all)
/parties/:id            Party profile

/payments               Payment list
/payments/receive       Receive payment form
/payments/pay           Make payment form
/payments/bank-rec      Bank reconciliation

/gst                    GST overview
/gst/gstr1              GSTR-1
/gst/gstr3b             GSTR-3B
/gst/recon              GSTR-2B reconciliation
/gst/itc                ITC register
/gst/h1                 H1 / X register
/gst/licenses           Drug licenses

/reports                Owner dashboard
/reports/sales          Sales reports
/reports/purchases      Purchase reports
/reports/inventory      Inventory reports
/reports/financial      Financial reports

/catalogue              Item list
/catalogue/:id          Item detail

/settings               Settings home
/settings/users         Users & roles
/settings/org           Organisation
/settings/print         Print templates

/owner                  (existing) cashier invite management
/import                 (existing) import hub
/import/smart           (existing) smart importer
```

---

## Sidebar layout

```
┌─────────────────┐
│  ≡  Salt        │  ← hamburger collapses to icon-only
├─────────────────┤
│  ⌨  Counter   C │  ← always first; highlighted when on /
│  🛒 Purchases P │
│  📄 Sales     S │
│  📦 Inventory I │
│  👥 Parties   A │
│  💰 Payments  M │
│  📊 GST       T │
│  📈 Reports   R │
├─────────────────┤
│  🏷  Catalogue K│  ← secondary; less frequent
├─────────────────┤
│  ⚙  Settings  , │
└─────────────────┘
```

Icon + label in expanded mode. Icon only in collapsed mode. Letter shortcut shown right-aligned. Active module highlighted. Cashier sees only Counter row.

---

## What's built vs. what this IA adds

**The navigation shell itself is built** (`apps/web/src/components/nav/`): a role-gated left sidebar rendering this full nested tree from `navConfig.ts`, with built modules linked and everything unbuilt shown disabled, plus `g`+letter go-to (`useGoToNav.ts`). It wraps all protected routes via `AppLayout`. So every path below is *visible*; the table is which ones are *active*.

| Screen | Status |
|---|---|
| `/` Counter | ✅ built (keyboard billing, FEFO, useBill, place_order, F9 save) |
| `/bills` Bill History / Sales → Invoices | ✅ built |
| `/parties` Party List | ✅ built |
| `/parties/:id` Party Profile | ✅ built |
| `/owner` Settings → Users & invites | ✅ built |
| `/import`, `/import/smart` Settings → Import | ✅ built |
| Purchases · Inventory · Payments · GST · Reports · Catalogue (+ unbuilt sub-items) | ⬜ visible but disabled in the sidebar |

## Related
[architecture/billing-screen](billing-screen.md) · [architecture/screens-routing](screens-routing.md) · [domain/persona-wholesale-owner](../domain/persona-wholesale-owner.md) · [product/product-modules](../product/product-modules.md) · [domain/orders](../domain/orders.md)
