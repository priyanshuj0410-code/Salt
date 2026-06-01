import type { BillLine, DiscountType, Payment } from "./types";
import { apportionedLineNets, NO_BILL_DISCOUNT, type BillDiscount } from "./billing";
import type { Tender } from "./tenders";
import { computeGrnLine } from "./grn";

/** Thrown when a save outlives its timeout (the request may still have landed). */
export class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

/**
 * Race a promise against a timeout so a hung request can't strand the UI on
 * "Saving…". Rejects with TimeoutError after `ms`. Note: the underlying write
 * may still complete server-side — callers must treat a timeout as "unknown",
 * not "failed", to avoid duplicate submissions.
 */
export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** A party bound to a bill/order. null = walk-in. */
export interface OrderParty {
  id: string;
  name: string;
}

/**
 * Prescription details captured at checkout for a Schedule H1/X sale. doctorName,
 * patientName and patientAddress are mandatory (the H1 register requires them);
 * doctorRegNo is optional. Persisted today on the invoice: doctorName →
 * `sales_invoices.doctor_name` + `doctor_reg_no` / `patient_name` / `patient_address`,
 * sent **structured** to `create_sales_invoice`, which writes the `h1_register` row and
 * enforces the gate server-side (migration 0032 / SALT-148 / SALT-185) — not folded into notes.
 */
export interface RxDetails {
  doctorName: string;
  doctorRegNo: string;
  patientName: string;
  patientAddress: string;
}

/** One-line human summary of the Rx — for **display** only (e.g. a receipt line).
 *  No longer the persistence path: structured params now go to `create_sales_invoice`. */
export function formatRxNote(rx: RxDetails): string {
  const parts = [`Patient: ${rx.patientName} (${rx.patientAddress})`];
  if (rx.doctorRegNo.trim()) parts.push(`Dr reg: ${rx.doctorRegNo.trim()}`);
  return `Schedule H1/X · ${parts.join(" · ")}`;
}

export type OrderDirection = "sale" | "purchase";

/** One line in the create_sales_invoice RPC payload (snake_case to match the SQL). */
export interface OrderLinePayload {
  item_id: string | null;
  name: string;
  batch_no: string;
  expiry: string;
  qty: number;
  rate_paise: number;
  discount_type: string;
  discount_value: number;
  gst_rate: number;
  line_total_paise: number;
  /** Sale price for the received batch — purchases only; the RPC ignores it for sales. */
  mrp_paise?: number;
}

/** Args for the create_sales_invoice RPC (keys match the SQL parameter names). */
export interface SalesInvoiceArgs {
  p_shop_id: string;
  p_party_id: string | null;
  p_payment_method: string;
  p_credit_days: number;
  p_lines: OrderLinePayload[];
  p_invoice_no: string | null;
  /** Schedule H1/X prescription, sent structured so the server writes the h1_register row
   *  + passes enforce_h1_gate (SALT-148/185); the gate rolls the invoice back if incomplete. */
  p_doctor_name: string | null;
  p_doctor_reg_no: string | null;
  p_patient_name: string | null;
  p_patient_address: string | null;
  p_notes: string | null;
  /** Split-tender legs (SALT-198). Omitted entirely for a single-payment bill so the
   *  call still resolves against the pre-0034 RPC signature; the server re-validates
   *  that these sum to the invoice total and that a credit leg has a party. */
  p_tenders?: Tender[];
}

/**
 * Build the create_sales_invoice args for a sale composed on the billing screen.
 * The RPC is authoritative for the GST split (it backs CGST/SGST/IGST out of each
 * tax-inclusive line total) and posts the stock movement + double entry, so the
 * client only sends item/batch/qty/rate.
 */
export function buildSalesInvoicePayload(
  shopId: string,
  party: OrderParty | null,
  lines: BillLine[],
  payment: Payment,
  rx: RxDetails | null = null,
  billDiscount: BillDiscount = NO_BILL_DISCOUNT,
  tenders: Tender[] | null = null,
  notes: string | null = null,
): SalesInvoiceArgs {
  // Send the post-bill-discount net as each line total, so the server's GST split
  // (backed out of line_total_paise) matches what the counter displayed.
  const nets = apportionedLineNets(lines, billDiscount);
  // A split with a credit leg needs the credit-days even though the single method
  // may be cash; the server uses p_credit_days for that leg's due date.
  const hasCreditTender = !!tenders?.some((t) => t.mode === "credit");
  const args: SalesInvoiceArgs = {
    p_shop_id: shopId,
    p_party_id: party?.id ?? null,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" || hasCreditTender ? payment.creditDays : 0,
    p_invoice_no: null,
    // Structured Rx params (not folded into notes) — the server backs the h1_register
    // row out of these and enforce_h1_gate rejects the invoice if any is missing.
    p_doctor_name: rx?.doctorName.trim() || null,
    p_doctor_reg_no: rx?.doctorRegNo.trim() || null,
    p_patient_name: rx?.patientName.trim() || null,
    p_patient_address: rx?.patientAddress.trim() || null,
    p_notes: notes,
    p_lines: lines.map((l, i) => ({
      item_id: l.itemId,
      name: l.name,
      batch_no: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      rate_paise: l.mrpPaise,
      discount_type: l.discountType,
      discount_value: l.discountValue,
      gst_rate: l.gstRate,
      line_total_paise: nets[i],
    })),
  };
  // Only attach p_tenders for a real split — a single-payment bill omits the key so
  // the RPC resolves cleanly even before migration 0034 is applied (graceful rollout).
  if (tenders && tenders.length > 0) args.p_tenders = tenders;
  return args;
}

/** One line entered in the GRN (vendor purchase) form. */
export interface PurchaseLine {
  itemId: string;
  name: string;
  batchNo: string;
  expiry: string; // YYYY-MM (or empty)
  qty: number;
  /** Scheme free goods (e.g. the "1" in 10+1): enter stock, carry zero ITC. */
  freeQty: number;
  ptrPaise: number; // cost per unit, tax-exclusive — what we pay the vendor
  mrpPaise: number; // sale price for the received batch
  gstRate: number;
  /** Trade discount on the line: "pct" of gross, or "flat" paise off. */
  discountType?: DiscountType;
  discountValue?: number;
  /** Free-text scheme note (e.g. "10+1", "2% CD") kept for the record. */
  schemeText?: string;
}

/** One line in the receive_purchase RPC payload (snake_case to match the SQL). */
export interface PurchaseLinePayload {
  item_id: string;
  name: string;
  batch_no: string;
  expiry: string;
  qty: number;
  free_qty: number;
  ptr_paise: number;
  mrp_paise: number;
  gst_rate: number;
  /** Tax-exclusive taxable value (gross − trade discount). The RPC trusts this
   *  if sent, else falls back to qty×ptr — so discounts must come through here. */
  taxable_paise: number;
  discount_type: string | null;
  discount_value: number;
  scheme_text: string | null;
}

/** Args for the receive_purchase (GRN) RPC (keys match the SQL parameter names). */
export interface ReceivePurchaseArgs {
  p_shop_id: string;
  p_vendor_id: string;
  p_vendor_invoice_no: string | null;
  p_vendor_invoice_date: string | null;
  p_payment_method: string;
  p_credit_days: number;
  p_lines: PurchaseLinePayload[];
  p_grn_no?: string | null;
}

/** Invoice/GRN metadata captured alongside the lines. */
export interface GrnMeta {
  vendorInvoiceNo?: string;
  /** YYYY-MM-DD. */
  vendorInvoiceDate?: string;
  grnNo?: string;
}

/**
 * Build the receive_purchase args for a GRN. The RPC adds stock (qty + free
 * goods), splits CGST/SGST/IGST off the cost, and posts the stock movement +
 * double entry (Dr Purchase + Dr GST input = Cr vendor). It trusts the
 * `taxable_paise` we send (so trade discounts are honoured) and derives the tax
 * split from `interstate` itself — we pass the same flag to `computeGrnLine` so
 * the stored numbers equal what the user saw.
 */
export function buildReceivePurchasePayload(
  shopId: string,
  vendor: OrderParty,
  lines: PurchaseLine[],
  payment: Payment,
  interstate: boolean,
  meta: GrnMeta = {},
): ReceivePurchaseArgs {
  return {
    p_shop_id: shopId,
    p_vendor_id: vendor.id,
    p_vendor_invoice_no: meta.vendorInvoiceNo?.trim() || null,
    p_vendor_invoice_date: meta.vendorInvoiceDate || null,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" ? payment.creditDays : 0,
    p_grn_no: meta.grnNo?.trim() || null,
    p_lines: lines.map((l) => ({
      item_id: l.itemId,
      name: l.name,
      batch_no: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      free_qty: l.freeQty || 0,
      ptr_paise: l.ptrPaise,
      mrp_paise: l.mrpPaise,
      gst_rate: l.gstRate,
      taxable_paise: computeGrnLine(l, interstate).taxablePaise,
      discount_type: l.discountType ?? null,
      discount_value: l.discountValue ?? 0,
      scheme_text: l.schemeText?.trim() || null,
    })),
  };
}

/** A persisted order row (subset used for dues/history). */
export interface OrderRow {
  id: string;
  direction: OrderDirection;
  total_paise: number;
  paid_paise: number;
}

/**
 * Signed outstanding of an order, in paise: a sale is a receivable (+, the
 * party owes us), a purchase is a payable (−, we owe the party). Settled
 * (paid) amount is netted off.
 */
export function orderOutstanding(o: OrderRow): number {
  const unpaid = o.total_paise - o.paid_paise;
  return o.direction === "sale" ? unpaid : -unpaid;
}

/**
 * A party's current amount due (signed: + = receivable, − = payable):
 * the imported opening balance plus the outstanding of every in-app order.
 * opening_balance already nets the imported ledger_bills, so they are not
 * added again here.
 */
export function partyDue(openingBalancePaise: number, orders: OrderRow[]): number {
  return orders.reduce((sum, o) => sum + orderOutstanding(o), openingBalancePaise);
}

/** Args for the record_payment RPC (keys match the SQL parameter names). */
export interface RecordPaymentArgs {
  p_shop_id: string;
  p_party_id: string;
  p_direction: "received" | "paid";
  p_mode: string;
  p_amount_paise: number;
  p_reference: string | null;
}

/** Build the record_payment args. 'received' (from a customer) lowers their
 *  receivable; 'paid' (to a vendor) lowers our payable. Posts the cash/bank <->
 *  party double entry server-side. */
export function buildPaymentPayload(
  shopId: string,
  partyId: string,
  direction: "received" | "paid",
  mode: string,
  amountPaise: number,
  reference: string,
): RecordPaymentArgs {
  return {
    p_shop_id: shopId,
    p_party_id: partyId,
    p_direction: direction,
    p_mode: mode,
    p_amount_paise: amountPaise,
    p_reference: reference.trim() || null,
  };
}

/**
 * Signed effect of recorded payments on a party's amount due (+ = receivable).
 * A receipt ('received') reduces what they owe; a payment ('paid') reduces what
 * we owe (moves a payable toward zero). Payments don't touch document paid_paise,
 * so this is added on top of partyDue without double-counting.
 */
export function paymentsAdjustment(
  payments: { direction: "received" | "paid"; amount_paise: number }[],
): number {
  return payments.reduce(
    (sum, p) => sum + (p.direction === "paid" ? p.amount_paise : -p.amount_paise),
    0,
  );
}
