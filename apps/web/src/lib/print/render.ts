import type { InvoicePrintData, InvoiceLine, PrintFormat } from "./types";
import { formatPaise, splitInclusiveGst } from "../currency";
import { PAGE_RULE, PRINT_FORMATS, FORMAT_LABEL, FORMAT_WIDTH, FORMAT_LAYOUT } from "./format";
import { FORMAT_KEY } from "./prefs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plainInr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees without the ₹ glyph — many dot-matrix / impact printer fonts can't render it. */
const rs = (paise: number): string => plainInr.format(paise / 100);

const padR = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s.slice(s.length - n) : " ".repeat(n - s.length) + s);

/** Per-line discount, recovered from gross (MRP × qty) minus the net charged. */
const lineDisc = (l: InvoiceLine): number => l.mrpPaise * l.qty - l.netPaise;

// ─────────────────────────────────────────── receipt (thermal 58 / 80 mm)

function receiptLineRow(l: InvoiceLine): string {
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

function receiptTotalRow(label: string, value: string, strong = false): string {
  return `<tr class="${strong ? "tot" : ""}"><td colspan="3" class="r">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
}

function receiptBody(d: InvoicePrintData): string {
  const shopMeta = [d.shop.address, d.shop.phone && `Ph: ${d.shop.phone}`, d.shop.gstin && `GSTIN: ${d.shop.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join("<br>");
  const custMeta = [d.customer?.phone, d.customer?.gstin && `GSTIN: ${d.customer.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  const taxRows = d.isInterstate
    ? receiptTotalRow("IGST", formatPaise(d.igst))
    : receiptTotalRow("CGST", formatPaise(d.cgst)) + receiptTotalRow("SGST", formatPaise(d.sgst));
  const payLabel = d.payment.method === "credit" ? "Credit" : "Cash";
  return `<div class="receipt">
    <div class="shop"><h1>${esc(d.shop.name)}</h1><div class="meta">${shopMeta}</div></div>
    <hr>
    <div class="row"><span>Tax Invoice</span><span>${esc(d.dateTime)}</span></div>
    <div class="row"><span>Ref: ${esc(d.ref)}</span><span>${esc(payLabel)}</span></div>
    <div class="bill-to"><strong>${esc(d.customerName)}</strong>${custMeta ? `<br><span class="meta">${custMeta}</span>` : ""}</div>
    <table>
      <thead><tr><th class="l">Item</th><th class="r">Qty</th><th class="r">MRP</th><th class="r">Amt</th></tr></thead>
      <tbody>${d.lines.map(receiptLineRow).join("")}</tbody>
      <tfoot>
        ${receiptTotalRow("Gross (MRP)", formatPaise(d.gross))}
        ${d.discount > 0 ? receiptTotalRow("Discount", `- ${formatPaise(d.discount)}`) : ""}
        ${receiptTotalRow("Taxable", formatPaise(d.taxable))}
        ${taxRows}
        ${receiptTotalRow("Total", formatPaise(d.grand), true)}
      </tfoot>
    </table>
    <div class="foot">Thank you. Get well soon.</div>
  </div>`;
}

// ─────────────────────────────────────────── sheet (A4)

function sheetItemRow(l: InvoiceLine, i: number): string {
  const { taxable } = splitInclusiveGst(l.netPaise, l.gstRate);
  const disc = lineDisc(l);
  const sub = [l.batchNo && `B: ${l.batchNo}`, l.expiry && `Exp ${l.expiry}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  return `<tr>
    <td class="r">${i + 1}</td>
    <td>${esc(l.name)}<div class="sub">${esc(l.pack)}${sub ? ` · ${sub}` : ""}</div></td>
    <td>${esc(l.hsn ?? "")}</td>
    <td class="r">${l.qty}</td>
    <td class="r">${formatPaise(l.mrpPaise)}</td>
    <td class="r">${disc > 0 ? formatPaise(disc) : "—"}</td>
    <td class="r">${formatPaise(taxable)}</td>
    <td class="r">${l.gstRate}%</td>
    <td class="r">${formatPaise(l.netPaise)}</td>
  </tr>`;
}

function sheetBody(d: InvoicePrintData): string {
  const shopLines = [d.shop.address, d.shop.phone && `Ph: ${d.shop.phone}`]
    .filter(Boolean)
    .map((s) => `<div>${esc(String(s))}</div>`)
    .join("");
  const custLines = [d.customer?.phone, d.customer?.gstin && `GSTIN: ${d.customer.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  const supply = d.isInterstate ? "Inter-state (IGST)" : "Intra-state (CGST + SGST)";
  const taxRows = d.isInterstate
    ? `<tr><td>IGST</td><td>${formatPaise(d.igst)}</td></tr>`
    : `<tr><td>CGST</td><td>${formatPaise(d.cgst)}</td></tr><tr><td>SGST</td><td>${formatPaise(d.sgst)}</td></tr>`;
  const payLabel = d.payment.method === "credit" ? `Credit (${d.payment.creditDays} days)` : "Cash";
  return `<div class="sheet">
    <div class="s-head">
      <div class="s-shop">
        <h1>${esc(d.shop.name)}</h1>
        ${shopLines}
        ${d.shop.gstin ? `<div><strong>GSTIN: ${esc(d.shop.gstin)}</strong></div>` : ""}
      </div>
      <div class="s-title">
        <div class="s-doctype">TAX INVOICE</div>
        <table class="s-meta">
          <tr><td>Invoice No</td><td>${esc(d.ref)}</td></tr>
          <tr><td>Date</td><td>${esc(d.dateTime)}</td></tr>
          <tr><td>Payment</td><td>${esc(payLabel)}</td></tr>
        </table>
      </div>
    </div>
    <div class="s-billto">
      <div><span class="lbl">Bill To</span><strong>${esc(d.customerName)}</strong>${custLines ? `<div class="sub">${custLines}</div>` : ""}</div>
      <div><span class="lbl">Place of supply</span>${supply}</div>
    </div>
    <table class="s-items">
      <thead><tr>
        <th class="r">#</th><th>Item</th><th>HSN</th><th class="r">Qty</th>
        <th class="r">MRP</th><th class="r">Disc</th><th class="r">Taxable</th><th class="r">GST</th><th class="r">Amount</th>
      </tr></thead>
      <tbody>${d.lines.map(sheetItemRow).join("")}</tbody>
    </table>
    <div class="s-bottom">
      <div class="s-notes"></div>
      <table class="s-totals">
        <tr><td>Gross (MRP)</td><td>${formatPaise(d.gross)}</td></tr>
        ${d.discount > 0 ? `<tr><td>Discount</td><td>- ${formatPaise(d.discount)}</td></tr>` : ""}
        <tr><td>Taxable value</td><td>${formatPaise(d.taxable)}</td></tr>
        ${taxRows}
        <tr class="grand"><td>Grand total</td><td>${formatPaise(d.grand)}</td></tr>
      </table>
    </div>
    <div class="s-sign">For ${esc(d.shop.name)}<div class="s-sign-line">Authorised signatory</div></div>
  </div>`;
}

// ─────────────────────────────────────────── mono (dot-matrix / challan)

const MONO_W = 61;
const monoRule = "=".repeat(MONO_W);
const monoDash = "-".repeat(MONO_W);
const monoCenter = (s: string): string => {
  if (s.length >= MONO_W) return s.slice(0, MONO_W);
  return " ".repeat(Math.floor((MONO_W - s.length) / 2)) + s;
};
const monoSplit = (left: string, right: string): string =>
  left.length + right.length >= MONO_W ? `${left} ${right}` : padR(left, MONO_W - right.length) + right;
const monoTotal = (label: string, value: string): string => padL(padR(label, 16) + padL(value, 14), MONO_W);

function monoBody(d: InvoicePrintData): string {
  const lines: string[] = [];
  lines.push(monoCenter(d.shop.name.toUpperCase()));
  if (d.shop.address) lines.push(monoCenter(d.shop.address));
  const idLine = [d.shop.phone && `Ph: ${d.shop.phone}`, d.shop.gstin && `GSTIN: ${d.shop.gstin}`]
    .filter(Boolean)
    .join("  ");
  if (idLine) lines.push(monoCenter(idLine));
  lines.push(monoRule);
  lines.push(monoSplit(`Invoice: ${d.ref}`, `Date: ${d.dateTime}`));
  lines.push(`Customer: ${d.customerName}`);
  if (d.customer?.gstin) lines.push(`GSTIN   : ${d.customer.gstin}`);
  lines.push(monoDash);
  lines.push(padR("Item", 30) + " " + padL("Qty", 5) + " " + padL("MRP", 11) + " " + padL("Amount", 12));
  lines.push(monoDash);
  for (const l of d.lines) {
    lines.push(padR(l.name, 30) + " " + padL(String(l.qty), 5) + " " + padL(rs(l.mrpPaise), 11) + " " + padL(rs(l.netPaise), 12));
    const sub = [l.pack, l.batchNo && `B:${l.batchNo}`, l.expiry && `Exp ${l.expiry}`].filter(Boolean).join("  ");
    if (sub) lines.push(padR("  " + sub, MONO_W));
  }
  lines.push(monoDash);
  lines.push(monoTotal("Gross (MRP)", rs(d.gross)));
  if (d.discount > 0) lines.push(monoTotal("Discount", "-" + rs(d.discount)));
  lines.push(monoTotal("Taxable", rs(d.taxable)));
  if (d.isInterstate) {
    lines.push(monoTotal("IGST", rs(d.igst)));
  } else {
    lines.push(monoTotal("CGST", rs(d.cgst)));
    lines.push(monoTotal("SGST", rs(d.sgst)));
  }
  lines.push(monoTotal("TOTAL", rs(d.grand)));
  lines.push(monoRule);
  lines.push(monoCenter("Thank you. Get well soon."));
  return `<pre class="mono">${esc(lines.join("\n"))}</pre>`;
}

// ─────────────────────────────────────────── document assembly

// Per-format screen width + which layout shows — generated from the format registry.
const WIDTH_RULES = PRINT_FORMATS.map((f) => `body[data-format="${f}"] .doc{width:${FORMAT_WIDTH[f]}}`).join("\n");
const VIS_RULES =
  PRINT_FORMATS.map((f) => `body[data-format="${f}"] #doc-${FORMAT_LAYOUT[f]}`).join(",\n") + "{display:block}";

const STYLE = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#f4f4f5;padding:14px;font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#000}
.doc{display:none;margin:14px auto 0;background:#fff;padding:6mm;box-shadow:0 1px 6px rgba(0,0,0,.18)}
${WIDTH_RULES}
${VIS_RULES}
/* toolbar (screen only) */
.toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:760px;margin:0 auto;
  padding:8px 10px;border:1px solid #d4d4d8;border-radius:8px;background:#fff}
.toolbar .lbl{color:#71717a;font-size:12px;margin-right:2px}
.toolbar .spacer{flex:1}
.toolbar button{font:inherit;font-size:13px;padding:5px 11px;border:1px solid #d4d4d8;border-radius:6px;background:#fff;color:#18181b;cursor:pointer}
.toolbar button.on{background:#18181b;color:#fff;border-color:#18181b}
.toolbar button.go{background:#2563eb;color:#fff;border-color:#2563eb;font-weight:600}
/* receipt */
.receipt{font-size:11px;line-height:1.45}
.receipt .shop{text-align:center}
.receipt h1{margin:0 0 2px;font-size:15px}
.receipt .meta{font-size:10px;color:#333}
.receipt hr{border:none;border-top:1px dashed #999;margin:6px 0}
.receipt .row{display:flex;justify-content:space-between;font-size:10px}
.receipt .bill-to{font-size:11px;margin:2px 0}
.receipt table{width:100%;border-collapse:collapse;margin-top:4px}
.receipt th{font-size:9px;text-transform:uppercase;color:#555;border-bottom:1px solid #000;padding:2px 0}
.receipt td{padding:3px 0;vertical-align:top}
.receipt .r{text-align:right}.receipt .l{text-align:left}
.receipt .sub{font-size:9px;color:#555}
.receipt tbody tr{border-bottom:1px dotted #ccc}
.receipt tfoot td{padding:2px 0}
.receipt tr.tot td{border-top:1px solid #000;font-weight:700;font-size:13px;padding-top:4px}
.receipt .foot{text-align:center;font-size:10px;color:#333;margin-top:8px}
/* sheet */
.sheet{font-size:12px;color:#111}
.sheet .s-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px}
.sheet .s-shop h1{margin:0 0 4px;font-size:20px}
.sheet .s-shop div{font-size:11px;color:#333;line-height:1.4}
.sheet .s-title{text-align:right;min-width:40%}
.sheet .s-doctype{font-size:15px;font-weight:700;letter-spacing:.06em;margin-bottom:6px}
.sheet .s-meta{margin-left:auto;border-collapse:collapse;font-size:11px}
.sheet .s-meta td{padding:1px 0 1px 10px;text-align:right}
.sheet .s-meta td:first-child{color:#666;text-align:left;padding-left:0}
.sheet .s-billto{display:flex;justify-content:space-between;gap:16px;margin:10px 0;font-size:12px}
.sheet .s-billto .lbl{display:block;font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.04em}
.sheet .s-billto .sub{color:#555;font-size:11px}
.sheet table.s-items{width:100%;border-collapse:collapse;margin-top:4px;font-size:11px}
.sheet table.s-items th{background:#f4f4f5;border:1px solid #d4d4d8;padding:5px 6px;font-size:10px;text-transform:uppercase;color:#555;text-align:left}
.sheet table.s-items td{border:1px solid #e4e4e7;padding:4px 6px;vertical-align:top}
.sheet table.s-items th.r,.sheet table.s-items td.r{text-align:right}
.sheet table.s-items .sub{color:#777;font-size:10px}
.sheet .s-bottom{display:flex;justify-content:space-between;gap:20px;margin-top:10px}
.sheet .s-totals{margin-left:auto;border-collapse:collapse;font-size:12px;min-width:240px}
.sheet .s-totals td{padding:3px 0 3px 16px;text-align:right}
.sheet .s-totals td:first-child{text-align:left;color:#555;padding-left:0}
.sheet .s-totals tr.grand td{border-top:2px solid #111;font-weight:700;font-size:14px;padding-top:6px}
.sheet .s-sign{margin-top:30px;text-align:right;font-size:11px}
.sheet .s-sign-line{margin-top:26px;border-top:1px solid #888;display:inline-block;padding-top:3px;color:#555}
/* mono */
.mono{font-family:"Courier New",monospace;font-size:12px;line-height:1.35;white-space:pre;color:#000;margin:0}
@media print{
  body{background:#fff;padding:0}
  .toolbar{display:none!important}
  .doc{box-shadow:none;margin:0;padding:0;width:auto!important}
}`;

/**
 * Inline controller for the print popup: switches format (re-targets the `@page`
 * paper + swaps which layout shows), remembers the choice in this origin's
 * localStorage, and auto-fires the print dialog on load so the F9 fast path is
 * unchanged. The popup is left open so the operator can re-print in another
 * format. Written without template-literal syntax so it survives interpolation.
 */
const SCRIPT = `(function(){
var FMT=${JSON.stringify(PAGE_RULE)};
var KEY=${JSON.stringify(FORMAT_KEY)};
function setFormat(f){
  if(!FMT[f])return;
  document.body.setAttribute("data-format",f);
  document.getElementById("pagestyle").textContent=FMT[f];
  try{localStorage.setItem(KEY,f);}catch(e){}
  var bs=document.querySelectorAll(".toolbar [data-f]");
  for(var i=0;i<bs.length;i++){bs[i].className=bs[i].getAttribute("data-f")===f?"on":"";}
}
var btns=document.querySelectorAll(".toolbar [data-f]");
for(var i=0;i<btns.length;i++){(function(b){b.onclick=function(){setFormat(b.getAttribute("data-f"));};})(btns[i]);}
var go=document.getElementById("go");if(go)go.onclick=function(){window.print();};
var cl=document.getElementById("close");if(cl)cl.onclick=function(){window.close();};
window.onload=function(){window.focus();window.print();};
})();`;

/** Build the invoice HTML document (self-contained, inline styles, all formats). */
export function invoiceHtml(d: InvoicePrintData, opts: { format: PrintFormat }): string {
  const fmt = opts.format;
  const fmtButtons = PRINT_FORMATS.map(
    (f) => `<button data-f="${f}"${f === fmt ? ' class="on"' : ""}>${esc(FORMAT_LABEL[f])}</button>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(d.ref)}</title>
<style id="pagestyle">${PAGE_RULE[fmt]}</style>
<style>${STYLE}</style></head>
<body data-format="${fmt}">
<div class="toolbar">
  <span class="lbl">Format</span>${fmtButtons}
  <span class="spacer"></span>
  <button id="go" class="go">Print</button>
  <button id="close">Close</button>
</div>
<div class="doc" id="doc-receipt">${receiptBody(d)}</div>
<div class="doc" id="doc-sheet">${sheetBody(d)}</div>
<div class="doc" id="doc-mono">${monoBody(d)}</div>
<script>${SCRIPT}</script>
</body></html>`;
}
