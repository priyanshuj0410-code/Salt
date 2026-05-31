import type { BillLine, Payment } from "./types";
import { lineNet } from "./billing";

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
 * `sales_invoices.doctor_name`, the rest folded into `notes` via `formatRxNote`.
 * (A follow-up DB slice will write the structured `h1_register` rows.)
 */
export interface RxDetails {
  doctorName: string;
  doctorRegNo: string;
  patientName: string;
  patientAddress: string;
}

/** One-line audit note for the invoice from captured Rx details. */
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
  p_doctor_name: string | null;
  p_notes: string | null;
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
): SalesInvoiceArgs {
  return {
    p_shop_id: shopId,
    p_party_id: party?.id ?? null,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" ? payment.creditDays : 0,
    p_invoice_no: null,
    p_doctor_name: rx?.doctorName.trim() || null,
    p_notes: rx ? formatRxNote(rx) : null,
    p_lines: lines.map((l) => ({
      item_id: l.itemId,
      name: l.name,
      batch_no: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      rate_paise: l.mrpPaise,
      discount_type: l.discountType,
      discount_value: l.discountValue,
      gst_rate: l.gstRate,
      line_total_paise: lineNet(l),
    })),
  };
}

/** One line entered in the vendor purchase form. */
export interface PurchaseLine {
  itemId: string;
  name: string;
  batchNo: string;
  expiry: string; // YYYY-MM (or empty)
  qty: number;
  ptrPaise: number; // cost — what we pay the vendor
  mrpPaise: number; // sale price for the received batch
  gstRate: number;
}

/** One line in the receive_purchase RPC payload (snake_case to match the SQL). */
export interface PurchaseLinePayload {
  item_id: string;
  name: string;
  batch_no: string;
  expiry: string;
  qty: number;
  ptr_paise: number;
  mrp_paise: number;
  gst_rate: number;
  free_qty?: number;
  scheme_text?: string;
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
}

/**
 * Build the receive_purchase args for a GRN entered on a vendor profile. The RPC
 * adds stock (qty + free goods), backs CGST/SGST/IGST off the cost, and posts the
 * stock movement + double entry (Dr Purchase + Dr GST input = Cr vendor). Taxable
 * defaults to qty x PTR server-side, so the client only sends item/batch/qty/cost.
 */
export function buildReceivePurchasePayload(
  shopId: string,
  vendor: OrderParty,
  lines: PurchaseLine[],
  payment: Payment,
): ReceivePurchaseArgs {
  return {
    p_shop_id: shopId,
    p_vendor_id: vendor.id,
    p_vendor_invoice_no: null,
    p_vendor_invoice_date: null,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" ? payment.creditDays : 0,
    p_lines: lines.map((l) => ({
      item_id: l.itemId,
      name: l.name,
      batch_no: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      ptr_paise: l.ptrPaise,
      mrp_paise: l.mrpPaise,
      gst_rate: l.gstRate,
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
