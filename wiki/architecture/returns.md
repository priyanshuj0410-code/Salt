---
type: architecture
updated: 2026-06-01
tags: [returns, gst, itc, credit-note, debit-note, schemes]
---

# Returns — partial-return recomputation engine

The **reverse flows** of inventory (product-modules §8): a customer returns goods to the
shop (**sales return** → credit note → receivable down, outward GST liability reversed in
GSTR-1) or the shop returns goods to a distributor (**purchase return** → debit note →
payable down, **ITC reversed**). Returns are high-frequency in pharma (expiry, breakage,
distributor recalls), so getting the money right matters.

This page covers the **economics core** (SALT-099): the pure recomputation that decides,
for a *partial* return, how much net value and GST/ITC to reverse. The screens that drive
it live in other modules — purchase returns in [grn](grn.md)
(`components/grn/DebitNote*`), sales returns/credit notes in `components/bills/` — and are
being moved onto this engine (see **As-built**).

## The hard problem (why a naive return is wrong)

A naive return reverses `qty × PTR`. The PRD flags this as where every ERP fails
(product-modules §8): *"A partial return (5 of 30 strips returned from a batch with a
trade discount scheme and scheme free goods) requires careful re-computation of the net
purchase value, the GST paid, and the revised ITC. No current ERP gets this fully right."*

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
that net value is the **revised ITC**. This is the same `effectiveCostPaise` that
[`computeGrnLine`](grn.md) already uses for valuation/COGS, so a return reverses exactly
what the GRN posted. Returning the "free" strip still reverses its *weighted share* of
cost — strips in a batch are fungible, and the weighted-average is the defensible figure.

**No paise leak.** Net value *and* GST are apportioned by **cumulative rounding** against
the units already returned: this note reverses `(through already+this) − (through
already)`. So a run of partial returns sums to the exact original taxable/ITC, and the
return that empties the batch reconciles the remainder precisely — verified by smoke
(sequential 1+1+1 of a ₹0.10 / 3-unit line sums back to the whole, GST included).

## Engine — `lib/returns.ts` (pure)

No Supabase; the return mirror of `lib/grn.ts`, which it reuses. Powers both note types —
the GST is "ITC reversed" for a purchase return and "outward-tax reversed" for a sales
return; the arithmetic is identical.

- **`ReturnBasis`** `{ receivedQty, taxablePaise, gstRate, returnedQty? }` — the original
  received line reduced to what apportionment needs. `receivedQty` = paid + free units;
  `returnedQty` = units already returned in prior notes (drives reconciliation).
- **`basisFromGrnLine(line, returnedQty?)`** — derive a basis from a raw GRN/purchase line
  (`qty, freeQty, ptrPaise, discountType/Value, gstRate`) via `computeGrnLine`.
- **`recomputeReturn(basis, requestedQty, interstate?)` → `ReturnLineResult`** — one line:
  `netValuePaise`, `cgst/sgst/igstPaise`, `gstPaise` (ITC/outward-tax reversed),
  `totalPaise`, `effectiveUnitCostPaise`, and `clamped` (requested > returnable balance →
  reduced). GST split matches `computeGrnLine`/`receive_purchase` (intra: floor→CGST,
  remainder→SGST; inter: all IGST).
- **`recomputeReturnNote(items, interstate?)` → `{ lines, totals }`** — a whole note with a
  per-GST-rate breakup (`GrnRateBucket[]`) for the footer and the GSTR credit/debit-note
  tables.
- **`returnableQty(basis)`** — `received − alreadyReturned`, for the UI cap.

## As-built status

- **Engine (SALT-099): done.** `lib/returns.ts`, smoke 17/17 (effective-cost vs naive,
  trade-discount + free-goods honoured, no-paise-leak reconciliation, clamping, GST
  split). lint + build green. **No migration** — pure client logic.
- **Screen wiring: handed off.** The debit-note screen ([grn](grn.md)) and the credit-note
  screen (bills) currently compute returns the naive way (`debitNoteTotals` in `lib/grn.ts`
  uses raw `qty × ptr`). Adopting this engine — fetching the original `purchase_lines` /
  `sale_lines` basis (incl. `free_qty`, discount) and the prior-return balance — is
  cross-module work, filed as tickets against grn and bills rather than edited here.

## Related
- [grn](grn.md) — inbound economics (`computeGrnLine`, `effectiveCostPaise`, the debit-note screen) this reuses and mirrors.
- [gst-returns](gst-returns.md) — where reversed ITC (3B Table 4B) and credit/debit notes (GSTR-1) land.
- [billing-screen](billing-screen.md) — line + apportioned bill-level discount, the sales-return basis.
- product-modules.md §8 (Returns) — the source requirement.
