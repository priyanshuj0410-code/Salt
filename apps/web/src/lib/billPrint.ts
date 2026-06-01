import {
  invoiceRef,
  printInvoice,
  type CustomerDetail,
  type InvoiceLine,
  type InvoicePrintData,
  type ShopHeader,
} from "@/lib/printInvoice";
import type { Payment, PaymentMethod } from "@/lib/types";

// SALT-028 — reprint a PERSISTED bill from history. buildInvoiceData (in the
// print module) reads live bill-store state at save time; that is gone by the
// time we reprint, so this rebuilds the same print payload from the stored
// sales_invoices + sale_lines rows. Stored paise are used verbatim — the GST
// split, taxable and total are never recomputed, so a reprint is faithful to the
// original. Rendering (format/template/docType) is owned by printInvoice.

/** Persisted sales-invoice header — the fields a reprint needs. */
export interface SavedInvoice {
  id: string;
  invoice_no: string | null;
  created_at: string;
  payment_method: string | null;
  credit_days: number | null;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

/** Persisted sale line — the fields a reprint needs. */
export interface SavedLine {
  name: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  rate_paise: number; // MRP (tax-inclusive); sale_lines has no separate mrp column
  gst_rate: number;
  line_total_paise: number;
}

// The client Payment type is binary (cash | credit). card/upi/bank all print as a
// cash sale (matching the counter); only an explicit credit sale shows "Credit".
function asPaymentMethod(m: string | null): PaymentMethod {
  return m === "credit" ? "credit" : "cash";
}

/**
 * Assemble the printable invoice payload from a stored bill. The original
 * timestamp is printed (not "now"), interstate is inferred from a non-zero IGST
 * so the CGST/SGST-vs-IGST presentation matches what was charged, and the receipt
 * is flagged as a duplicate via the reference line.
 */
export function buildSavedInvoicePrintData(args: {
  invoice: SavedInvoice;
  lines: SavedLine[];
  shop: ShopHeader;
  customerName: string;
  customer: CustomerDetail | null;
}): InvoicePrintData {
  const { invoice, lines, shop, customerName, customer } = args;
  const payment: Payment = {
    method: asPaymentMethod(invoice.payment_method),
    creditDays: invoice.credit_days ?? 0,
  };
  const gross = lines.reduce((s, l) => s + Math.round(l.qty * l.rate_paise), 0);
  const lineSum = lines.reduce((s, l) => s + l.line_total_paise, 0);
  const billDiscount = invoice.discount_paise;
  // Whatever MRP gross is not in the line totals or the bill discount is the
  // per-line discount the customer got off MRP.
  const discount = Math.max(0, gross - lineSum - billDiscount);
  return {
    ref: invoice.invoice_no?.trim() || invoiceRef(invoice.id),
    dateTime: new Date(invoice.created_at).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    shop,
    customerName,
    customer,
    isInterstate: invoice.igst_paise > 0,
    payment,
    lines: lines.map<InvoiceLine>((l) => ({
      name: l.name,
      pack: "",
      batchNo: l.batch_no ?? "",
      expiry: l.expiry ?? "",
      qty: l.qty,
      mrpPaise: l.rate_paise,
      netPaise: l.line_total_paise,
      gstRate: l.gst_rate,
    })),
    gross,
    discount,
    billDiscount,
    taxable: invoice.taxable_paise,
    cgst: invoice.cgst_paise,
    sgst: invoice.sgst_paise,
    igst: invoice.igst_paise,
    grand: invoice.total_paise,
    reference: "DUPLICATE / REPRINT",
  };
}

/**
 * Reprint a saved bill: open the print window via the shared printInvoice (which
 * applies the operator's saved format/template/doc-type), flagged as a duplicate.
 * PDF = the print dialog Save-as-PDF. Popup-blocked is swallowed by printInvoice;
 * the bill is already saved, so the user can simply reprint after allowing popups.
 */
export function printSavedBill(data: InvoicePrintData): void {
  printInvoice(data);
}
