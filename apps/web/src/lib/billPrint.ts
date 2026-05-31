import {
  invoiceHtml,
  invoiceRef,
  type CustomerDetail,
  type InvoiceLine,
  type InvoicePrintData,
  type ShopHeader,
} from "@/lib/printInvoice";
import type { Payment, PaymentMethod } from "@/lib/types";

// SALT-028 — reprint a PERSISTED bill from history. buildInvoiceData (in
// printInvoice.ts) reads live bill-store state at save time; that is gone by the
// time we reprint, so this rebuilds the same print payload from the stored
// sales_invoices + sale_lines rows. Stored paise are used verbatim — the GST
// split, taxable and total are never recomputed, so a reprint is faithful to the
// original.

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
  pack: string | null;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  mrp_paise: number;
  gst_rate: number;
  line_total_paise: number;
}

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "upi", "bank", "credit"];

function asPaymentMethod(m: string | null): PaymentMethod {
  return PAYMENT_METHODS.includes(m as PaymentMethod) ? (m as PaymentMethod) : "cash";
}

/**
 * Assemble the printable invoice payload from a stored bill. The original
 * timestamp is printed (not "now"), and interstate is inferred from a non-zero
 * IGST so the CGST/SGST-vs-IGST presentation matches what was charged.
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
  const gross = lines.reduce((s, l) => s + Math.round(l.qty * l.mrp_paise), 0);
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
      pack: l.pack ?? "",
      batchNo: l.batch_no ?? "",
      expiry: l.expiry ?? "",
      qty: l.qty,
      mrpPaise: l.mrp_paise,
      netPaise: l.line_total_paise,
      gstRate: l.gst_rate,
    })),
    gross,
    discount: invoice.discount_paise,
    taxable: invoice.taxable_paise,
    cgst: invoice.cgst_paise,
    sgst: invoice.sgst_paise,
    igst: invoice.igst_paise,
    grand: invoice.total_paise,
  };
}

/** Stamp the invoice HTML as a duplicate (ribbon just after <body>). */
function withReprintMark(html: string): string {
  const ribbon =
    '<div style="text-align:center;border:1px dashed #000;font-weight:700;' +
    'font-size:11px;letter-spacing:1px;padding:2px;margin-bottom:4px;">DUPLICATE / REPRINT</div>';
  return html.replace("<body>", `<body>${ribbon}`);
}

/**
 * Open a reprint of a saved bill in a new window and trigger the print dialog
 * (the user can pick a printer or "Save as PDF"). Mirrors printInvoice but
 * stamps the receipt as a duplicate. Returns false if the popup was blocked —
 * the bill is already saved, so the caller can surface a retry hint.
 */
export function printSavedBill(data: InvoicePrintData): boolean {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return false;
  w.document.write(withReprintMark(invoiceHtml(data)));
  w.document.close();
  return true;
}
