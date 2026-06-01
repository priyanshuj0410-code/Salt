import { computeGrnLine, type GrnLineInput, type GrnRateBucket } from "./grn";

// SALT-099 — Partial-return recomputation: net value / GST / ITC, with schemes + free goods.
//
// The hard problem the PRD flags (product-modules §8 "Returns"): "A partial return
// (5 of 30 strips returned from a batch with a trade discount scheme and scheme free
// goods) requires careful re-computation of the net purchase value, the GST paid, and
// the revised ITC. No current ERP gets this fully right."
//
// A naive return reverses qty × PTR. That over-reverses: it ignores the trade discount
// and prices the scheme free goods at full rate. The faithful basis is the *effective
// cost* — the line's net taxable spread across every physical unit that entered stock
// (paid + free): effectiveCost = taxable ÷ (qty + freeQty). Returning N physical units
// reverses N × effectiveCost of net value, and the GST on that is the "revised ITC".
//
// Sequential partial returns apportion by *cumulative* rounding (both net and GST), so
// they never leak a paise: the running total always equals the rounded share of the
// whole, and the return that empties the batch reverses the line's ITC exactly.
//
// Pure module (no Supabase) — the outbound/return mirror of the inbound economics in
// lib/grn.ts, which it reuses so a return reverses exactly what the GRN posted. It
// powers both purchase returns (debit note → payable down, ITC reversal) and sales
// returns (credit note → receivable down, outward-tax reversal): identical math, where
// the GST is "ITC reversed" one way and "output liability reversed" the other.

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The original received line a return is taken against, reduced to the only facts the
 * apportionment needs: how many physical units entered stock, their net taxable (after
 * trade discount — the ITC base), and the GST rate.
 */
export interface ReturnBasis {
  /** Physical units received = invoiced qty + scheme free qty. The return apportions against THIS. */
  receivedQty: number;
  /** Net taxable (ex-GST), after trade discount — the ITC base for the whole batch, in paise. */
  taxablePaise: number;
  /** GST rate (%) on the line. */
  gstRate: number;
  /** Units already returned against this line in prior notes — for cumulative, leak-free reconciliation. */
  returnedQty?: number;
}

/**
 * Build a {@link ReturnBasis} straight from a raw GRN/purchase line (qty, free, ptr,
 * trade discount) by reusing {@link computeGrnLine} — so the return reverses exactly
 * the taxable the GRN posted. `interstate` is irrelevant to the basis (it only splits
 * the GST, not the taxable or the stock count), so we compute with `false`.
 */
export function basisFromGrnLine(line: GrnLineInput, returnedQty = 0): ReturnBasis {
  const c = computeGrnLine(line, false);
  return { receivedQty: c.stockQty, taxablePaise: c.taxablePaise, gstRate: line.gstRate, returnedQty };
}

/** Units still returnable against a line = received − already returned. */
export function returnableQty(basis: ReturnBasis): number {
  const received = Math.max(0, Math.floor(basis.receivedQty || 0));
  return Math.max(0, received - clamp(Math.floor(basis.returnedQty || 0), 0, received));
}

/**
 * CGST/SGST/IGST split of a line's GST, matching {@link computeGrnLine} and the
 * `receive_purchase` server posting: inter-state ⇒ all IGST; intra-state ⇒ floor to
 * CGST with the remainder to SGST, so the two always sum back to `gstPaise`.
 */
function splitGst(gstPaise: number, interstate: boolean): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
  if (interstate) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

/**
 * Net taxable attributable to the first `n` physical units of the batch (effective-cost
 * apportionment, rounded). A whole batch returns the *exact* original taxable, so
 * differencing two cumulative values never leaks a paise across sequential returns.
 */
function cumulativeNet(n: number, basis: ReturnBasis): number {
  const received = Math.max(0, Math.floor(basis.receivedQty || 0));
  if (n <= 0 || received <= 0 || basis.taxablePaise <= 0) return 0;
  if (n >= received) return basis.taxablePaise;
  return Math.round((basis.taxablePaise * n) / received);
}

/** GST on the first `n` physical units — rounded off the cumulative net, so it too reconciles to the line's exact GST at n = received. */
function cumulativeGst(n: number, basis: ReturnBasis): number {
  return Math.round((cumulativeNet(n, basis) * (basis.gstRate || 0)) / 100);
}

export interface ReturnLineResult {
  /** Units actually returned (clamped to what is still returnable). */
  returnQty: number;
  /** Net value (ex-GST) reversed for these units, effective-cost basis, in paise. */
  netValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** GST on the returned net value: ITC reversed (purchase) / outward tax reversed (sales), in paise. */
  gstPaise: number;
  /** netValue + GST — what comes off the vendor payable / customer receivable, in paise. */
  totalPaise: number;
  /** Effective cost per physical unit (taxable ÷ received), ex-GST — the weighted-average basis, in paise. */
  effectiveUnitCostPaise: number;
  /** True when the requested qty exceeded the returnable balance and was reduced. */
  clamped: boolean;
}

/**
 * Recompute one partial return against its original received line. `interstate` drives
 * the IGST-vs-CGST/SGST split. Value and GST are apportioned on the *effective cost*
 * (so the trade discount and scheme free goods are honoured) via *cumulative* rounding
 * against `basis.returnedQty`, so sequential partial returns sum to the exact original
 * ITC — the return that empties the batch reconciles the remainder.
 */
export function recomputeReturn(basis: ReturnBasis, requestedQty: number, interstate = false): ReturnLineResult {
  const received = Math.max(0, Math.floor(basis.receivedQty || 0));
  const alreadyReturned = clamp(Math.floor(basis.returnedQty || 0), 0, received);
  const remaining = received - alreadyReturned;
  const wanted = Math.max(0, Math.floor(requestedQty || 0));
  const returnQty = clamp(wanted, 0, remaining);

  // This note reverses (through already+this) − (through already), for both net and GST,
  // so a run of partial returns sums to the whole line without rounding drift.
  const netValuePaise = cumulativeNet(alreadyReturned + returnQty, basis) - cumulativeNet(alreadyReturned, basis);
  const gstPaise = cumulativeGst(alreadyReturned + returnQty, basis) - cumulativeGst(alreadyReturned, basis);
  const { cgstPaise, sgstPaise, igstPaise } = splitGst(gstPaise, interstate);

  return {
    returnQty,
    netValuePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    gstPaise,
    totalPaise: netValuePaise + gstPaise,
    effectiveUnitCostPaise: received > 0 ? Math.round(basis.taxablePaise / received) : 0,
    clamped: returnQty < wanted,
  };
}

/** One line of a multi-line return note: the original line it is taken against + the qty being returned. */
export interface ReturnRequestLine {
  basis: ReturnBasis;
  returnQty: number;
}

export interface ReturnTotals {
  netValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Total GST reversed across the note = total ITC reversal (purchase) / outward-tax reversal (sales). */
  gstPaise: number;
  /** netValue + GST — what the whole note takes off the payable / receivable. */
  grandTotalPaise: number;
  /** Per-GST-rate breakup, for the note footer and the GSTR credit/debit-note tables. */
  byRate: GrnRateBucket[];
}

export interface ReturnComputation {
  lines: ReturnLineResult[];
  totals: ReturnTotals;
}

/** Recompute every line of a return note and roll up the document totals with a per-GST-rate breakup. */
export function recomputeReturnNote(items: ReturnRequestLine[], interstate = false): ReturnComputation {
  const lines = items.map((it) => recomputeReturn(it.basis, it.returnQty, interstate));
  const buckets = new Map<number, GrnRateBucket>();
  let netValuePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  lines.forEach((r, i) => {
    netValuePaise += r.netValuePaise;
    cgstPaise += r.cgstPaise;
    sgstPaise += r.sgstPaise;
    igstPaise += r.igstPaise;
    const rate = items[i].basis.gstRate || 0;
    const b = buckets.get(rate) ?? { rate, taxablePaise: 0, gstPaise: 0 };
    b.taxablePaise += r.netValuePaise;
    b.gstPaise += r.gstPaise;
    buckets.set(rate, b);
  });
  const gstPaise = cgstPaise + sgstPaise + igstPaise;
  return {
    lines,
    totals: {
      netValuePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      gstPaise,
      grandTotalPaise: netValuePaise + gstPaise,
      byRate: [...buckets.values()].sort((a, b) => a.rate - b.rate),
    },
  };
}
