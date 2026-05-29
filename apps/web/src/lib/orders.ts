import type { BillLine, Payment } from "./types";
import { lineNet } from "./billing";

/** A party bound to a bill/order. null = walk-in. */
export interface OrderParty {
  id: string;
  name: string;
}

export type OrderDirection = "sale" | "purchase";

/** One line in the place_order RPC payload (snake_case to match the SQL). */
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

/** Args for the place_order RPC (keys match the SQL parameter names). */
export interface PlaceOrderArgs {
  p_direction: OrderDirection;
  p_party_id: string | null;
  p_payment_method: string;
  p_credit_days: number;
  p_lines: OrderLinePayload[];
  p_order_no: string | null;
}

/** Build the place_order args for a sale composed on the billing screen. */
export function buildSalePayload(
  party: OrderParty | null,
  lines: BillLine[],
  payment: Payment,
): PlaceOrderArgs {
  return {
    p_direction: "sale",
    p_party_id: party?.id ?? null,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" ? payment.creditDays : 0,
    p_order_no: null,
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

/** Build the place_order args for a purchase entered on a vendor profile. */
export function buildPurchasePayload(
  party: OrderParty,
  lines: PurchaseLine[],
  payment: Payment,
): PlaceOrderArgs {
  return {
    p_direction: "purchase",
    p_party_id: party.id,
    p_payment_method: payment.method,
    p_credit_days: payment.method === "credit" ? payment.creditDays : 0,
    p_order_no: null,
    p_lines: lines.map((l) => ({
      item_id: l.itemId,
      name: l.name,
      batch_no: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      rate_paise: l.ptrPaise,
      discount_type: "flat",
      discount_value: 0,
      gst_rate: l.gstRate,
      line_total_paise: l.ptrPaise * l.qty,
      mrp_paise: l.mrpPaise,
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
