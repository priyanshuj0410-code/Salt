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
  schedule: Schedule;
  barcode?: string;
  /** AYUSH / non-allopathic item (ayurveda, siddha, unani, homeopathy). These
   *  carry no Drugs-&-Cosmetics schedule and describe contents, not a salt. */
  ayush?: boolean;
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
  /** Total available stock for the item across all batches — the per-item cap. */
  stock: number;
  qty: number;
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
