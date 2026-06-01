export type Schedule = "OTC" | "H" | "H1" | "X";

export interface Batch {
  batchNo: string;
  /** YYYY-MM; FEFO picks the earliest-expiring batch with stock. */
  expiry: string;
  qty: number;
  /** MRP per pack in paise, inclusive of GST (Indian pharma convention). */
  mrpPaise: number;
  /** Price to retailer per pack in paise — what the shop paid (landed cost). */
  ptrPaise: number;
  /** Base units in the currently-open pack (SALT-164 / migration 0057); absent ⇒ 0. */
  looseUnits?: number;
}

export interface Item {
  id: string;
  name: string;
  salt: string;
  manufacturer: string;
  pack: string;
  hsn: string;
  /** GST rate as a percentage, e.g. 5, 12, 18. */
  gstRate: number;
  /** Date-effective GST rate class from the linked master item (`master_items.gst_rate_class`),
   *  e.g. "std" | "ayush" | "nil" | "gst18". With the catalog store's loaded `gstSchedule`,
   *  date-sensitive screens resolve the rate in force on a document date via
   *  `gstRateForClass` (back-dated GRNs, the 22-Sep-2025 medicine cutover). Absent ⇒
   *  unlinked / pre-schedule item ⇒ fall back to the flat `gstRate`. */
  gstRateClass?: string;
  schedule: Schedule;
  /** Base units per pack, e.g. 10 tablets per strip (`items.units_per_pack`, migration 0057).
   *  Enables loose-unit (part-strip) sale at the counter; absent / null ⇒ 1 (sold whole only). */
  unitsPerPack?: number;
  barcode?: string;
  /** AYUSH / non-allopathic item (ayurveda, siddha, unani, homeopathy). These
   *  carry no Drugs-&-Cosmetics schedule and describe contents, not a salt. */
  ayush?: boolean;
  /** Therapeutic / drug class (e.g. "Antidiabetic"). Back-filled from the brand
   *  crosswalk via "Fill from master"; "" / absent when unknown. */
  therapeuticCategory?: string;
  /** Reorder point: the stock level at/below which this item should be re-bought.
   *  Drives the inventory reorder report; 0 = not set. */
  reorderLevel?: number;
  /** Needs temperature-controlled storage (insulin, vaccines) — cold-chain. */
  coldChain?: boolean;
  /** Relative sales velocity for this shop; used as a ranking tie-breaker. */
  velocity: number;
  batches: Batch[];
}

export type DiscountType = "pct" | "flat";

export interface BillLine {
  /** Stable line key: itemId + batchNo (different batches are separate lines). */
  key: string;
  itemId: string;
  name: string;
  salt: string;
  pack: string;
  /** HSN code — carried from the catalogue item so the tax invoice can print it (rule-46 field). */
  hsn: string;
  schedule: Schedule;
  gstRate: number;
  batchNo: string;
  expiry: string;
  mrpPaise: number;
  ptrPaise: number;
  /** Billed unit rate in paise (SALT-191A). Defaults to MRP; a customer pricing rule
   *  (`resolve_price`) or a manual edit can lower it. Absent (e.g. an older held bill)
   *  ⇒ the math falls back to `mrpPaise`, i.e. today's behaviour. */
  ratePaise?: number;
  /** Why this rate — the winning price rule's label, or "MRP" / "Manual". */
  ruleLabel?: string;
  /** A manual rate edit sticks: price resolution will not overwrite it. */
  priceOverridden?: boolean;
  /** The party the rate was resolved for ("" = walk-in); null/undefined = not yet resolved. */
  pricedForParty?: string | null;
  /** Total available stock for the item across all batches — the per-item cap. */
  stock: number;
  qty: number;
  /** Loose-unit (part-strip) line (SALT-164): when true, `qty` is base UNITS, not packs —
   *  e.g. 4 tablets from a strip of 10. Priced per unit (rate ÷ unitsPerPack). Absent ⇒ whole packs. */
  loose?: boolean;
  /** Base units per pack, snapshot from the item; absent ⇒ 1 (not divisible). */
  unitsPerPack?: number;
  /** "pct" = percentage of line gross; "flat" = rupees off the line, in paise. */
  discountType: DiscountType;
  discountValue: number;
}

export type PaymentMethod = "cash" | "credit";

export interface Payment {
  method: PaymentMethod;
  /** Repayment window in days, used when method is "credit". */
  creditDays: number;
}
