export type Schedule = "OTC" | "H" | "H1" | "X";

export interface Batch {
  batchNo: string;
  /** YYYY-MM; FEFO picks the earliest-expiring batch with stock. */
  expiry: string;
  qty: number;
  /** MRP per pack in paise, inclusive of GST (Indian pharma convention). */
  mrpPaise: number;
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
  /** Relative sales velocity for this shop; used as a ranking tie-breaker. */
  velocity: number;
  batches: Batch[];
}

export interface BillLine {
  /** Stable line key: itemId + batchNo (different batches are separate lines). */
  key: string;
  itemId: string;
  name: string;
  salt: string;
  pack: string;
  schedule: Schedule;
  gstRate: number;
  batchNo: string;
  expiry: string;
  mrpPaise: number;
  qty: number;
}
