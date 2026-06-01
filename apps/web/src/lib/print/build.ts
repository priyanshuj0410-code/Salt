import type { BillLine, Payment } from "../types";
import type { OrderParty } from "../orders";
import type { BillTotals } from "@/store/bill";
import { apportionedLineNets, gstSplit, type BillDiscount } from "../billing";
import type { InvoicePrintData, ShopHeader, CustomerDetail } from "./types";

/**
 * A short, human-readable bill reference derived from the invoice UUID. A proper
 * FY-scoped GST invoice series is SALT-013; until then this is the printed handle.
 */
export function invoiceRef(invoiceId: string): string {
  return invoiceId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/** Assemble the print payload from live bill state — called before `clear()` wipes it. */
export function buildInvoiceData(args: {
  invoiceId: string;
  shop: ShopHeader;
  party: OrderParty | null;
  customer: CustomerDetail | null;
  lines: BillLine[];
  payment: Payment;
  totals: BillTotals;
  billDiscount: BillDiscount;
  isInterstate: boolean;
}): InvoicePrintData {
  const { invoiceId, shop, party, customer, lines, payment, totals, billDiscount, isInterstate } = args;
  const { cgst, sgst, igst } = gstSplit(totals.gst, isInterstate);
  // Per-line amounts after the bill discount, so they sum to the printed Total.
  const nets = apportionedLineNets(lines, billDiscount);
  return {
    ref: invoiceRef(invoiceId),
    dateTime: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    shop,
    customerName: party?.name ?? "Walk-in customer",
    customer,
    isInterstate,
    payment,
    lines: lines.map((l, i) => ({
      name: l.name,
      pack: l.pack,
      hsn: l.hsn,
      batchNo: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      mrpPaise: l.mrpPaise,
      netPaise: nets[i],
      gstRate: l.gstRate,
    })),
    gross: totals.gross,
    discount: totals.discount,
    billDiscount: totals.billDiscount,
    taxable: totals.taxable,
    cgst,
    sgst,
    igst,
    grand: totals.grand,
  };
}
