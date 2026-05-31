import type { DiscountType } from "./types";

/**
 * GRN (goods receipt) economics — the *inbound* counterpart to billing.ts.
 *
 * Purchases are tax-EXCLUSIVE: the distributor quotes a PTR (price to retailer)
 * and adds GST on top — the inverse of MRP-inclusive retail sales (see
 * `splitInclusiveGst` in currency.ts). These helpers compute, per line and per
 * GRN, the taxable value, the CGST/SGST/IGST split, the ITC (input tax credit),
 * and the *effective cost* once scheme free goods are spread over the stock.
 *
 * The math mirrors the server `receive_purchase` RPC exactly so what the user
 * sees equals what is stored:
 *   taxable = qty*ptr − trade discount   (the client sends this as taxable_paise)
 *   tax     = round(taxable * rate/100)
 *   intra   → cgst = floor(tax/2), sgst = tax − cgst;  inter → igst = tax
 *   stock   += qty + free_qty            (free goods enter stock, carry zero ITC)
 */

/** One purchase line's inputs for computation (a subset of the UI PurchaseLine). */
export interface GrnLineInput {
  qty: number;
  /** Scheme free goods (e.g. the "1" in 10+1). Enter stock; carry zero taxable/ITC. */
  freeQty?: number;
  /** Cost per unit, tax-exclusive (PTR), in paise. */
  ptrPaise: number;
  /** GST rate as a percentage, e.g. 5, 12, 18. */
  gstRate: number;
  /** Trade discount: "pct" = percent of gross; "flat" = paise off the line. */
  discountType?: DiscountType | null;
  discountValue?: number;
}

export interface GrnLineComputed {
  /** qty × ptr, before discount. */
  grossPaise: number;
  discountPaise: number;
  /** gross − discount: the GST base and the ITC base. */
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Total GST on the line = the ITC claimable (full ITC; free goods add none). */
  gstPaise: number;
  /** taxable + GST — what this line adds to the vendor payable. */
  lineTotalPaise: number;
  /** Units added to stock = qty + freeQty. */
  stockQty: number;
  /** Real cost per received unit (taxable ÷ stockQty), ex-GST — the "10+1 is cheaper" number. */
  effectiveCostPaise: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Trade-discount amount in paise: percent of gross, or a flat paise amount, capped at gross. */
export function grnLineDiscount(
  grossPaise: number,
  type: DiscountType | null | undefined,
  value: number | undefined = 0,
): number {
  if (!value || grossPaise <= 0) return 0;
  if (type === "flat") return clamp(Math.round(value), 0, grossPaise);
  // default: percent
  return Math.round((grossPaise * clamp(value, 0, 100)) / 100);
}

/** Compute one GRN line. `interstate` drives the IGST-vs-CGST/SGST split. */
export function computeGrnLine(line: GrnLineInput, interstate: boolean): GrnLineComputed {
  const qty = Math.max(0, line.qty || 0);
  const free = Math.max(0, line.freeQty || 0);
  const grossPaise = Math.max(0, Math.round(qty * (line.ptrPaise || 0)));
  const discountPaise = grnLineDiscount(grossPaise, line.discountType ?? "pct", line.discountValue ?? 0);
  const taxablePaise = Math.max(0, grossPaise - discountPaise);
  const gstPaise = Math.round((taxablePaise * (line.gstRate || 0)) / 100);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (interstate) {
    igstPaise = gstPaise;
  } else {
    // Server uses integer division for CGST, remainder to SGST — match it.
    cgstPaise = Math.floor(gstPaise / 2);
    sgstPaise = gstPaise - cgstPaise;
  }

  const stockQty = qty + free;
  return {
    grossPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    gstPaise,
    lineTotalPaise: taxablePaise + gstPaise,
    stockQty,
    effectiveCostPaise: stockQty > 0 ? Math.round(taxablePaise / stockQty) : 0,
  };
}

/** Taxable + GST broken out per rate — for the multi-rate footer and ITC/GSTR-2 reporting. */
export interface GrnRateBucket {
  rate: number;
  taxablePaise: number;
  gstPaise: number;
}

export interface GrnTotals {
  /** Σ qty×ptr before discount. */
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  /** Total GST = total ITC claimable. */
  gstPaise: number;
  grandTotalPaise: number;
  /** Total scheme free units received (zero ITC). */
  freeQty: number;
  byRate: GrnRateBucket[];
}

/** Roll up GRN lines into document totals, with a per-GST-rate breakup. */
export function grnTotals(lines: GrnLineInput[], interstate: boolean): GrnTotals {
  let subtotalPaise = 0;
  let discountPaise = 0;
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let freeQty = 0;
  const buckets = new Map<number, GrnRateBucket>();

  for (const l of lines) {
    const c = computeGrnLine(l, interstate);
    subtotalPaise += c.grossPaise;
    discountPaise += c.discountPaise;
    taxablePaise += c.taxablePaise;
    cgstPaise += c.cgstPaise;
    sgstPaise += c.sgstPaise;
    igstPaise += c.igstPaise;
    freeQty += Math.max(0, l.freeQty || 0);
    const rate = l.gstRate || 0;
    const b = buckets.get(rate) ?? { rate, taxablePaise: 0, gstPaise: 0 };
    b.taxablePaise += c.taxablePaise;
    b.gstPaise += c.gstPaise;
    buckets.set(rate, b);
  }

  const gstPaise = cgstPaise + sgstPaise + igstPaise;
  return {
    subtotalPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    gstPaise,
    grandTotalPaise: taxablePaise + gstPaise,
    freeQty,
    byRate: [...buckets.values()].sort((a, b) => a.rate - b.rate),
  };
}

/**
 * Place of supply: a purchase is inter-state when the vendor's GST state differs
 * from the buying shop's. A vendor with no recorded state is treated as intra
 * (CGST/SGST) — matching the server, which can't split what it doesn't know.
 */
export function isInterstate(
  vendorStateCode: string | null | undefined,
  shopStateCode: string | null | undefined,
): boolean {
  if (!vendorStateCode) return false;
  return vendorStateCode !== shopStateCode;
}
