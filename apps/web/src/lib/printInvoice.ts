import type { BillLine, Payment } from "./types";
import type { OrderParty } from "./orders";
import type { BillTotals } from "@/store/bill";
import { formatPaise } from "./currency";
import { gstSplit, lineNet } from "./billing";

/** Shop header fields printed on the invoice (structural subset of auth `Shop`). */
export interface ShopHeader {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  state_code: string | null;
}

/** Customer contact detail fetched for the bound party (null = walk-in). */
export interface CustomerDetail {
  gstin: string | null;
  phone: string | null;
  state_code: string | null;
}

export interface InvoiceLine {
  name: string;
  pack: string;
  batchNo: string;
  expiry: string;
  qty: number;
  mrpPaise: number;
  netPaise: number;
  gstRate: number;
}

export interface InvoicePrintData {
  ref: string;
  dateTime: string;
  shop: ShopHeader;
  customerName: string;
  customer: CustomerDetail | null;
  isInterstate: boolean;
  payment: Payment;
  lines: InvoiceLine[];
  gross: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  grand: number;
}

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
  isInterstate: boolean;
}): InvoicePrintData {
  const { invoiceId, shop, party, customer, lines, payment, totals, isInterstate } = args;
  const { cgst, sgst, igst } = gstSplit(totals.gst, isInterstate);
  return {
    ref: invoiceRef(invoiceId),
    dateTime: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    shop,
    customerName: party?.name ?? "Walk-in customer",
    customer,
    isInterstate,
    payment,
    lines: lines.map((l) => ({
      name: l.name,
      pack: l.pack,
      batchNo: l.batchNo,
      expiry: l.expiry,
      qty: l.qty,
      mrpPaise: l.mrpPaise,
      netPaise: lineNet(l),
      gstRate: l.gstRate,
    })),
    gross: totals.gross,
    discount: totals.discount,
    taxable: totals.taxable,
    cgst,
    sgst,
    igst,
    grand: totals.grand,
  };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lineRow(l: InvoiceLine): string {
  const sub = [l.pack, l.batchNo && `B: ${l.batchNo}`, l.expiry && `Exp ${l.expiry}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  return `<tr>
    <td class="l">${esc(l.name)}${sub ? `<div class="sub">${sub}</div>` : ""}</td>
    <td class="r">${l.qty}</td>
    <td class="r">${formatPaise(l.mrpPaise)}</td>
    <td class="r">${formatPaise(l.netPaise)}</td>
  </tr>`;
}

function totalRow(label: string, value: string, strong = false): string {
  return `<tr class="${strong ? "tot" : ""}"><td colspan="3" class="r">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
}

/** Build the invoice HTML document (self-contained, inline styles for print). */
export function invoiceHtml(d: InvoicePrintData): string {
  const shopMeta = [
    d.shop.address,
    d.shop.phone && `Ph: ${d.shop.phone}`,
    d.shop.gstin && `GSTIN: ${d.shop.gstin}`,
  ]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join("<br>");
  const custMeta = [d.customer?.phone, d.customer?.gstin && `GSTIN: ${d.customer.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  const taxRows = d.isInterstate
    ? totalRow(`IGST`, formatPaise(d.igst))
    : totalRow(`CGST`, formatPaise(d.cgst)) + totalRow(`SGST`, formatPaise(d.sgst));
  const payLabel = d.payment.method === "credit" ? "Credit" : "Cash";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(d.ref)}</title>
<style>
  @page { margin: 6mm; }
  * { box-sizing: border-box; }
  body { width: 80mm; margin: 0 auto; font: 11px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; }
  .shop { text-align: center; }
  .shop h1 { margin: 0 0 2px; font-size: 15px; }
  .meta { font-size: 10px; color: #333; }
  hr { border: none; border-top: 1px dashed #999; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; font-size: 10px; }
  .bill-to { font-size: 11px; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { font-size: 9px; text-transform: uppercase; color: #555; border-bottom: 1px solid #000; padding: 2px 0; }
  td { padding: 3px 0; vertical-align: top; }
  th.r, td.r { text-align: right; }
  th.l, td.l { text-align: left; }
  .sub { font-size: 9px; color: #555; }
  tbody tr { border-bottom: 1px dotted #ccc; }
  tfoot td { padding: 2px 0; }
  tr.tot td { border-top: 1px solid #000; font-weight: 700; font-size: 13px; padding-top: 4px; }
  .foot { text-align: center; font-size: 10px; color: #333; margin-top: 8px; }
</style></head>
<body>
  <div class="shop">
    <h1>${esc(d.shop.name)}</h1>
    <div class="meta">${shopMeta}</div>
  </div>
  <hr>
  <div class="row"><span>Tax Invoice</span><span>${esc(d.dateTime)}</span></div>
  <div class="row"><span>Ref: ${esc(d.ref)}</span><span>${esc(payLabel)}</span></div>
  <div class="bill-to"><strong>${esc(d.customerName)}</strong>${custMeta ? `<br><span class="meta">${custMeta}</span>` : ""}</div>
  <table>
    <thead><tr><th class="l">Item</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Amt</th></tr></thead>
    <tbody>${d.lines.map(lineRow).join("")}</tbody>
    <tfoot>
      ${totalRow("Gross (MRP)", formatPaise(d.gross))}
      ${d.discount > 0 ? totalRow("Discount", `- ${formatPaise(d.discount)}`) : ""}
      ${totalRow("Taxable", formatPaise(d.taxable))}
      ${taxRows}
      ${totalRow("Total", formatPaise(d.grand), true)}
    </tfoot>
  </table>
  <div class="foot">Thank you. Get well soon.</div>
  <script>window.onload=function(){window.focus();window.print();};window.onafterprint=function(){window.close();};</script>
</body></html>`;
}

/** Open the invoice in a new window and trigger the browser print dialog. */
export function printInvoice(d: InvoicePrintData): void {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return; // popup blocked — the sale is already saved; user can reprint later
  w.document.write(invoiceHtml(d));
  w.document.close();
}
