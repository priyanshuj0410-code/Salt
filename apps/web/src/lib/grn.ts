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

// ── Purchase orders (PO) ─────────────────────────────────────────────────────
// A PO is *intent to order* placed before goods arrive: it moves no stock and
// posts no accounting (unlike a GRN). It is finalised into a GRN via
// `receive_purchase(p_po_id)` (the match/discrepancy half is SALT-024). The
// `purchase_orders` + `po_lines` tables are live; there is no `create_po` RPC,
// so a PO is inserted directly (client-side UUID, ADR 0007) like a party/item.

/** One line entered in the PO form. */
export interface PoLine {
  itemId: string;
  name: string;
  qty: number;
  /** Expected cost per unit (PTR), tax-exclusive, in paise. */
  ptrPaise: number;
  gstRate: number;
}

/** One `po_lines` row for insert (snake_case to match the table). */
export interface PoLinePayload {
  id: string;
  org_id: string;
  po_id: string;
  item_id: string;
  name: string;
  qty: number;
  ptr_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

/** Committed value of a PO line = qty × PTR (tax-exclusive; GST is settled at GRN). */
export function poLineTotal(line: { qty: number; ptrPaise: number }): number {
  return Math.max(0, Math.round((line.qty || 0) * (line.ptrPaise || 0)));
}

/** PO total = Σ line totals. */
export function poTotal(lines: { qty: number; ptrPaise: number }[]): number {
  return lines.reduce((sum, l) => sum + poLineTotal(l), 0);
}

/** Build the `po_lines` insert rows for a PO (each row carries org_id + po_id). */
export function buildPoLineRows(poId: string, orgId: string, lines: PoLine[]): PoLinePayload[] {
  return lines.map((l) => ({
    id: crypto.randomUUID(),
    org_id: orgId,
    po_id: poId,
    item_id: l.itemId,
    name: l.name,
    qty: l.qty,
    ptr_paise: l.ptrPaise,
    gst_rate: l.gstRate,
    line_total_paise: poLineTotal(l),
  }));
}

// ── PO ↔ GRN matching (SALT-024) ─────────────────────────────────────────────
// When a GRN is received against a PO, compare what was ordered vs what arrived
// and surface discrepancies (short/excess supply, price changes, missing/extra
// items) so the user reconciles before committing. Match is by item_id; received
// batches of the same item aggregate (10 from batch A + 5 from B vs an order of
// 15 is a clean match, not two shorts).

export interface MatchableLine {
  itemId: string | null;
  name: string;
  qty: number;
  ptrPaise: number;
}

export type DiscrepancyKind = "qty-short" | "qty-excess" | "price-mismatch" | "missing" | "extra";

export interface LineDiscrepancy {
  kind: DiscrepancyKind;
  itemId: string | null;
  name: string;
  orderedQty?: number;
  receivedQty?: number;
  orderedPtrPaise?: number;
  receivedPtrPaise?: number;
}

export interface PoMatch {
  discrepancies: LineDiscrepancy[];
  /** True when nothing differs between ordered and received. */
  matched: boolean;
  orderedTotalPaise: number; // Σ po qty×ptr
  receivedTotalPaise: number; // Σ grn qty×ptr
}

export function matchGrnToPo(grn: MatchableLine[], po: MatchableLine[]): PoMatch {
  const discrepancies: LineDiscrepancy[] = [];
  const poByItem = new Map<string, MatchableLine>();
  for (const p of po) if (p.itemId) poByItem.set(p.itemId, p);

  // Aggregate received qty per item (same-item batches sum together).
  const recvByItem = new Map<string, { qty: number; ptrPaise: number; name: string }>();
  for (const g of grn) {
    if (!g.itemId) {
      // An off-catalogue received line can't be matched — always an extra.
      discrepancies.push({ kind: "extra", itemId: null, name: g.name, receivedQty: g.qty, receivedPtrPaise: g.ptrPaise });
      continue;
    }
    const e = recvByItem.get(g.itemId);
    if (e) e.qty += g.qty;
    else recvByItem.set(g.itemId, { qty: g.qty, ptrPaise: g.ptrPaise, name: g.name });
  }

  for (const [itemId, r] of recvByItem) {
    const p = poByItem.get(itemId);
    if (!p) {
      discrepancies.push({ kind: "extra", itemId, name: r.name, receivedQty: r.qty, receivedPtrPaise: r.ptrPaise });
      continue;
    }
    if (r.qty !== p.qty) {
      discrepancies.push({
        kind: r.qty < p.qty ? "qty-short" : "qty-excess",
        itemId,
        name: p.name,
        orderedQty: p.qty,
        receivedQty: r.qty,
      });
    }
    if (r.ptrPaise !== p.ptrPaise) {
      discrepancies.push({
        kind: "price-mismatch",
        itemId,
        name: p.name,
        orderedPtrPaise: p.ptrPaise,
        receivedPtrPaise: r.ptrPaise,
      });
    }
  }

  // PO lines that nothing was received against.
  for (const p of po) {
    if (p.itemId && !recvByItem.has(p.itemId)) {
      discrepancies.push({ kind: "missing", itemId: p.itemId, name: p.name, orderedQty: p.qty });
    }
  }

  const orderedTotalPaise = po.reduce((s, p) => s + Math.round(p.qty * p.ptrPaise), 0);
  const receivedTotalPaise = grn.reduce((s, g) => s + Math.round(g.qty * g.ptrPaise), 0);
  return { discrepancies, matched: discrepancies.length === 0, orderedTotalPaise, receivedTotalPaise };
}

/** Short human label for a discrepancy chip. */
export function discrepancyLabel(d: LineDiscrepancy): string {
  switch (d.kind) {
    case "qty-short":
      return `short ${(d.orderedQty ?? 0) - (d.receivedQty ?? 0)} (ord ${d.orderedQty}, got ${d.receivedQty})`;
    case "qty-excess":
      return `excess ${(d.receivedQty ?? 0) - (d.orderedQty ?? 0)} (ord ${d.orderedQty}, got ${d.receivedQty})`;
    case "price-mismatch":
      return "price changed";
    case "missing":
      return `not received (ord ${d.orderedQty})`;
    case "extra":
      return "not on PO";
  }
}

// Note: purchase-return / debit-note economics moved to lib/returns.ts (SALT-190).
// The naive `debitNoteTotals`/`buildDebitNoteLines` (raw qty×PTR) over-reversed ITC
// for partial returns of scheme/discounted batches; DebitNoteEntryPage now uses the
// effective-cost engine (`recomputeReturnNote`) against the originating purchase line.

// ── Auto-PO / reorder suggestions (SALT-022) ─────────────────────────────────
// Surface items that need reordering and propose an order quantity, so the user
// turns the picks into draft POs (one per vendor) instead of eyeballing stock.
// Two triggers: (1) at/below the reorder level, (2) "fast-moving" — selling fast
// enough that current stock covers fewer than the target window. Pure: the page
// feeds it current stock (Σ batch qty), units sold in a window, and the last
// vendor/PTR per item (most recent purchase); no Supabase here.

/** Per-item inputs for a reorder suggestion. */
export interface ReorderItemInput {
  itemId: string;
  name: string;
  gstRate: number;
  /** items.reorder_level (0/absent = no explicit threshold). */
  reorderLevel: number;
  /** Current stock = Σ batches.qty for the item in this shop. */
  stockQty: number;
  /** Units sold in the lookback window (posted, non-imported sales). */
  soldInWindow: number;
  /** Most recent purchase vendor for this item, if any. */
  lastVendorId?: string | null;
  lastVendorName?: string | null;
  /** Most recent PTR (cost/unit, paise) — seeds the PO line price. */
  lastPtrPaise?: number | null;
}

export type ReorderReason = "below-reorder" | "fast-moving";

export interface ReorderSuggestion {
  itemId: string;
  name: string;
  gstRate: number;
  reorderLevel: number;
  stockQty: number;
  soldInWindow: number;
  /** Units sold per day over the window. */
  perDay: number;
  /** Days the current stock lasts at this velocity (Infinity if no sales). */
  daysOfCover: number;
  /** Proposed order quantity (≥ 1). */
  suggestedQty: number;
  reason: ReorderReason;
  lastVendorId: string | null;
  lastVendorName: string | null;
  lastPtrPaise: number | null;
}

export interface ReorderOptions {
  /** Lookback window for velocity, in days (e.g. 30/60/90). */
  windowDays: number;
  /** Target days of stock to reorder up to (the coverage horizon). Default 30. */
  targetDays?: number;
}

/**
 * Compute reorder suggestions. An item is suggested when stock is at/below its
 * reorder level, OR it is fast-moving (days-of-cover < targetDays). Suggested qty
 * tops stock up to cover `targetDays` of demand, and at least to the reorder
 * level — then rounds up to a whole unit (min 1). Inactive items are filtered by
 * the caller. Sorted most-urgent first (lowest days-of-cover).
 */
export function suggestReorders(items: ReorderItemInput[], opts: ReorderOptions): ReorderSuggestion[] {
  const windowDays = Math.max(1, opts.windowDays || 30);
  const targetDays = Math.max(1, opts.targetDays ?? 30);
  const out: ReorderSuggestion[] = [];

  for (const it of items) {
    const stock = Math.max(0, it.stockQty || 0);
    const sold = Math.max(0, it.soldInWindow || 0);
    const perDay = sold / windowDays;
    const daysOfCover = perDay > 0 ? stock / perDay : Infinity;
    const reorderLevel = Math.max(0, it.reorderLevel || 0);

    const belowReorder = reorderLevel > 0 && stock <= reorderLevel;
    const fastMoving = perDay > 0 && daysOfCover < targetDays;
    if (!belowReorder && !fastMoving) continue;

    // Top up to cover targetDays of demand, but never below the reorder level.
    const targetStock = Math.max(Math.ceil(perDay * targetDays), reorderLevel);
    const suggestedQty = Math.max(1, Math.ceil(targetStock - stock));

    out.push({
      itemId: it.itemId,
      name: it.name,
      gstRate: it.gstRate,
      reorderLevel,
      stockQty: stock,
      soldInWindow: sold,
      perDay,
      daysOfCover,
      suggestedQty,
      reason: belowReorder ? "below-reorder" : "fast-moving",
      lastVendorId: it.lastVendorId ?? null,
      lastVendorName: it.lastVendorName ?? null,
      lastPtrPaise: it.lastPtrPaise ?? null,
    });
  }

  return out.sort((a, b) => a.daysOfCover - b.daysOfCover);
}

// ── Send PO (SALT-023) ───────────────────────────────────────────────────────
// Vendor ordering is distributor-mediated with no self-serve API (ADR 0016), so
// "send" means a formatted plain-text PO the user pushes over WhatsApp / email /
// copy / print. Pure formatter; the channel deep-links live in the dialog.

export interface PoTextLine {
  name: string;
  qty: number;
  ptrPaise: number;
}

export interface PoTextInput {
  shopName?: string | null;
  vendorName: string;
  poRef: string;
  /** Human date string (already formatted by the caller). */
  date: string;
  expectedDate?: string | null;
  lines: PoTextLine[];
  totalPaise: number;
}

/** A clean plain-text purchase order for WhatsApp / email body / clipboard. */
export function formatPoText(po: PoTextInput): string {
  const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const from = po.shopName?.trim() ? ` from ${po.shopName.trim()}` : "";
  const out = [
    `Purchase Order ${po.poRef}${from}`,
    `To: ${po.vendorName}`,
    `Date: ${po.date}`,
  ];
  if (po.expectedDate) out.push(`Expected delivery: ${po.expectedDate}`);
  out.push("", "Items:");
  po.lines.forEach((l, i) => {
    out.push(`${i + 1}. ${l.name} — ${l.qty} @ ${inr(l.ptrPaise)} = ${inr(Math.round(l.qty * l.ptrPaise))}`);
  });
  out.push("", `Total (excl. GST): ${inr(po.totalPaise)}`, "", "Please confirm availability and dispatch. Thank you.");
  return out.join("\n");
}

// ── Vendor schemes (SALT-026) ────────────────────────────────────────────────
// A vendor scheme is a standing deal: a trade discount and/or a free-goods ratio,
// optionally scoped to one item, optionally time-boxed. At GRN entry we pick the
// active scheme for the (vendor, item) and auto-apply it, then flag when the keyed
// line diverges. Pure: the screen passes the rows it fetched from vendor_schemes.

export interface VendorScheme {
  id: string;
  vendorId: string;
  /** Null = vendor-wide (applies to any item); set = scoped to that item. */
  itemId: string | null;
  label: string | null;
  discountType: DiscountType | null;
  discountValue: number;
  schemeBuyQty: number;
  schemeFreeQty: number;
  /** YYYY-MM-DD or null (open-ended). */
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
}

/** True when `scheme` is active and `onDate` falls within its validity window. */
export function schemeIsActive(scheme: VendorScheme, onDate: string): boolean {
  if (!scheme.active) return false;
  if (scheme.validFrom && onDate < scheme.validFrom) return false;
  if (scheme.validTo && onDate > scheme.validTo) return false;
  return true;
}

/**
 * The scheme to apply for a (vendor, item) on a date: an item-specific scheme
 * wins over a vendor-wide one; among equals, the most recently valid (latest
 * validFrom) wins. Returns null when nothing active matches.
 */
export function activeSchemeFor(
  schemes: VendorScheme[],
  vendorId: string,
  itemId: string | null,
  onDate: string,
): VendorScheme | null {
  const candidates = schemes.filter(
    (s) =>
      s.vendorId === vendorId &&
      schemeIsActive(s, onDate) &&
      (s.itemId === null || s.itemId === itemId),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    // Item-specific first.
    if ((a.itemId === null) !== (b.itemId === null)) return a.itemId === null ? 1 : -1;
    // Then latest validFrom (nulls last).
    return (b.validFrom ?? "").localeCompare(a.validFrom ?? "");
  });
  return candidates[0];
}

/** Free units a scheme grants for a received qty: floor(qty/buy) × free. */
export function schemeFreeQtyFor(scheme: VendorScheme, qty: number): number {
  if (scheme.schemeBuyQty <= 0 || scheme.schemeFreeQty <= 0) return 0;
  return Math.floor(qty / scheme.schemeBuyQty) * scheme.schemeFreeQty;
}

export interface SchemeMismatch {
  /** The keyed line diverges from the scheme on the discount and/or free goods. */
  discountOff: boolean;
  freeQtyOff: boolean;
  /** What the scheme would apply, for the flag message. */
  expectedDiscountType: DiscountType | null;
  expectedDiscountValue: number;
  expectedFreeQty: number;
}

/**
 * Compare a keyed GRN line against the scheme. `expectedFreeQty` is computed from
 * the line qty + the buy/free ratio. Returns null when the line matches (or when
 * there is nothing to check).
 */
export function schemeMismatch(
  line: { qty: number; freeQty?: number; discountType?: DiscountType | null; discountValue?: number },
  scheme: VendorScheme,
): SchemeMismatch | null {
  const expectedFreeQty = schemeFreeQtyFor(scheme, line.qty);
  const expectedDiscountValue = scheme.discountType ? scheme.discountValue : 0;
  const keyedDiscountValue = line.discountType ? (line.discountValue ?? 0) : 0;
  // Discount diverges if the type differs (when the scheme has one) or the value differs.
  const discountOff = scheme.discountType
    ? line.discountType !== scheme.discountType || keyedDiscountValue !== expectedDiscountValue
    : false;
  const freeQtyOff = expectedFreeQty !== (line.freeQty ?? 0);
  if (!discountOff && !freeQtyOff) return null;
  return {
    discountOff,
    freeQtyOff,
    expectedDiscountType: scheme.discountType,
    expectedDiscountValue,
    expectedFreeQty,
  };
}
