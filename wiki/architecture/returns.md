---
type: architecture
updated: 2026-06-02
tags: [returns, gst, itc, credit-note, debit-note, schemes]
---

# Returns

The **reverse flows** of trade (product-modules §8): a customer returns goods to the shop
(**sales return** → credit note → receivable down, outward GST liability reversed) or the
shop returns goods to a distributor (**purchase return** → debit note → payable down,
**ITC reversed**). High-frequency in pharma (expiry, breakage, distributor recalls), so the
money must be exact. The module is **fully shipped end-to-end**: a shared recomputation
engine, both entry screens, double-entry posting, stock movements, and GST/ITC reversal.

The hard part is a **partial** return from a discounted / scheme batch — the engine
(SALT-099) — so it leads. The screens that drive it live in sibling modules (purchase
return in [grn](grn.md), sales return in bills), both now on this engine.

## The hard problem (why a naive return is wrong)

A naive return reverses `qty × PTR`. The PRD flags this as where every ERP fails
(product-modules §8): *"A partial return (5 of 30 strips returned from a batch with a trade
discount scheme and scheme free goods) requires careful re-computation of the net purchase
value, the GST paid, and the revised ITC. No current ERP gets this fully right."*

Two effects make `qty × PTR` over-reverse:
- **Trade discount** — the batch's real net taxable is `gross − discount`, not gross.
- **Scheme free goods** (the "1" in 10+1) — those units entered stock at **zero** invoice
  value, so the per-unit cost of *every* physical unit is lower than PTR.

**The fix — effective-cost basis.** The faithful per-unit cost is the line's net taxable
spread across **every physical unit received** (paid + free):

```
effectiveUnitCost = taxablePaise / (qty + freeQty)
```

Returning N physical units reverses `N × effectiveUnitCost` of net value, and the GST on
that is the **revised ITC**. This is the same `effectiveCostPaise` that
[`computeGrnLine`](grn.md) uses for valuation/COGS, so a return reverses exactly what the
GRN posted. Returning the "free" strip still reverses its *weighted share* — strips in a
batch are fungible, and the weighted-average is the defensible figure.

**No paise leak.** Net value *and* GST are apportioned by **cumulative rounding** against
the units already returned: a note reverses `(through already+this) − (through already)`. So
a run of partial returns sums to the exact original taxable/ITC, and the return that empties
the batch reconciles the remainder precisely (smoke: sequential 1+1+1 of a ₹0.10 / 3-unit
line sums back to the whole, GST included).

## Engine — `lib/returns.ts` (pure, SALT-099)

No Supabase; the return mirror of `lib/grn.ts`, which it reuses. Powers **both** note types —
the GST is "ITC reversed" for a purchase return and "outward-tax reversed" for a sales
return; the arithmetic is identical.

- **`ReturnBasis`** `{ receivedQty, taxablePaise, gstRate, returnedQty? }` — the original
  line reduced to what apportionment needs. `receivedQty` = paid + free units;
  `returnedQty` = units already returned in prior notes (drives reconciliation).
- **`basisFromGrnLine(line, returnedQty?)`** — derive a basis from a raw GRN line
  (`qty, freeQty, ptrPaise, discountType/Value, gstRate`) via `computeGrnLine`.
- **`recomputeReturn(basis, requestedQty, interstate?)` → `ReturnLineResult`** — one line:
  `netValuePaise`, `cgst/sgst/igstPaise`, `gstPaise`, `totalPaise`, `effectiveUnitCostPaise`,
  and `clamped` (requested > returnable → reduced). GST split matches
  `computeGrnLine`/`receive_purchase` (intra: floor→CGST, remainder→SGST; inter: all IGST).
- **`recomputeReturnNote(items, interstate?)` → `{ lines, totals }`** — a whole note with a
  per-GST-rate breakup (`GrnRateBucket[]`).
- **`returnableQty(basis)`** — `received − alreadyReturned`, for the UI cap.

## Flows & screens (as-built)

### Purchase return → debit note — `components/grn/DebitNoteEntryPage.tsx` (SALT-190)
Anchored to an originating GRN (`/purchases/…?purchase=<id>`). It loads that GRN's
`purchase_lines` (`qty, free_qty, ptr_paise, gst_rate, taxable_paise`) and builds the basis
**from the persisted line** — `receivedQty = qty + free_qty`, `taxablePaise =` the stored
post-discount taxable (no recompute). The **returnable cap** is cumulative: Σ
`debit_note_lines.qty` keyed by `purchase_line_id` across the org → `returnedQty`. Totals
come from `recomputeReturnNote`; the payload to `create_debit_note` sets each line's
`taxable_paise = ` the engine's `netValuePaise` (so the server's ITC reversal matches the
UI) and carries `purchase_line_id`. Settle modes: **credit** (reduce vendor payable) / cash
/ bank. List + detail: `DebitNoteListPage` / `DebitNoteDetailPage`. The naive
`debitNoteTotals`/`buildDebitNoteLines` were **removed** from `lib/grn.ts`.

### Sales return → credit note — `components/bills/ReturnDialog.tsx` + `CreditNotesPage.tsx` via `lib/billReturn.ts` (SALT-015, SALT-189)
Look up the original bill → its `sale_lines` + a prior-returned map (Σ
`credit_note_lines.qty` by `sale_line_id`). `lib/billReturn.ts` (`buildReturnEditorLines`,
`basisOf`, `computeReturn`, `buildCreditNoteLines`) wraps the engine: the sale line's
persisted `taxable_paise` is **already net of line + apportioned bill-level discount**
(`create_sales_invoice` backs it out of the discounted total), so it *is* the engine basis —
a partial return reverses the discounted net, never the gross. The payload to
`create_credit_note` sends `sale_line_id` + `line_total_paise =` the engine's tax-inclusive
`totalPaise`; the RPC backs taxable + GST out of that. Refund modes: **credit** (reduce
receivable) / cash / bank.

## Data model + RPCs — `0020_returns.sql`, `0037_sales_return_validation.sql`

Four tables, all standard per-org `is_member` RLS; two security-definer RPCs (resolve org
from `memberships`); both post a balanced double entry via `post_entry` and a
`stock_movement`, mirroring sales/GRN reversed.

- **`credit_notes` / `credit_note_lines`** + **`create_credit_note(p_shop_id, p_party_id,
  p_sale_invoice_id, p_reason, p_refund_mode, p_lines, …)`** — restock (`stock_movements`
  +qty, reason `sale_return`), reverse the sale (Dr `SALES_RET` + Dr GST **output** · Cr
  party / refund cash / bank). `credit_note_lines.sale_line_id` ties each line to the
  original sale line.
- **`debit_notes` / `debit_note_lines`** + **`create_debit_note(p_shop_id, p_vendor_id,
  p_purchase_id, p_reason, p_settle_mode, p_lines, …)`** — stock out (guarded `qty >= v_qty`;
  `stock_movements` −qty, reason `purchase_return`, `unit_cost_paise`), reverse the purchase
  (Dr vendor / cash / bank · Cr `PUR_RET` + Cr GST **input** = ITC reversal). Stores
  `itc_reversal_paise`; `debit_note_lines.purchase_line_id` ties back to the GRN line.
- **`0037` (SALT-015)** adds the sales-side **server guard**, no signature change: a line
  carrying a `sale_line_id` may not return more than `sold − already-returned` (counting only
  `status='placed'` notes), and links the line back to the sale. Imported returns history:
  `0026_import_returns.sql`.

## Decisions & gotchas

- **Effective-cost (weighted-average over received incl. free), not FIFO/specific-lot.** The
  defensible, fungible-strip basis; reverses exactly what was posted. The core SALT-099 call.
- **Cumulative rounding** on both net and GST → no paise leak across sequential partials.
- **The two RPCs take different bases** (an easy footgun): `create_debit_note` consumes a
  **pre-computed `taxable_paise`** per line — the client *must* send the engine's
  `netValuePaise`, else the server falls back to `qty × ptr` and over-reverses;
  `create_credit_note` consumes a tax-inclusive **`line_total_paise`** and back-computes the
  taxable. The two screens already send the right field.
- **Over-return is enforced asymmetrically.** Sales returns are capped **client-side**
  (`returnableQty`) **and server-side** (0037). Purchase returns are capped client-side
  (cumulative `debit_note_lines`) plus the RPC's stock-availability guard, but have **no
  dedicated server validation** against the purchase line — a parity follow-up.
- **GST split** uses floor→CGST, remainder→SGST (matches `receive_purchase`); inter-state ⇒
  all IGST.
- **Expiry destruction is a different path.** Writing off expired stock (with full ITC
  reversal) is the [inventory](inventory.md) `ExpiryDestructionPage` over `adjust_stock`
  (`0028`), not a debit note — debit notes are for *returns to the vendor*.

## Current state vs planned

**Shipped:** the engine; purchase-return + sales-return entry both wired to it; double-entry
posting; stock movements; ITC / output-tax reversal; refund/settle modes; server-side
sales over-return validation; returns-history import. Credit/debit notes surface in
[gst-returns](gst-returns.md) (GSTR-1 CDNR/CDNUR, GSTR-3B net of returns).

**Gaps / planned:** server-side over-return validation for *purchase* returns (parity with
0037); per-FY `note_no` series (today notes can be numbered by the caller); returns not tied
to an original document (free/ad-hoc returns); deeper CDNR auto-pickup lives in the gst lane.

## Related
- [grn](grn.md) — inbound economics (`computeGrnLine`, `effectiveCostPaise`) this reuses; the debit-note screen.
- [billing-screen](billing-screen.md) — line + apportioned bill-level discount; the sale line `taxable_paise` that is the sales-return basis.
- [gst-returns](gst-returns.md) — where reversed ITC (3B) and credit/debit notes (GSTR-1 CDNR/CDNUR) land.
- [inventory](inventory.md) — expiry destruction + ITC reversal (the non-vendor write-off path).
- Sources: `salt-prd-v0.3.md` (returns), product-modules.md §8.
