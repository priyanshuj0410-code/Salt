/**
 * Expiry-destruction workflow (SALT-044). Expired stock that is destroyed must
 * have its input tax credit reversed (CGST §17(5)(h)), and the destruction
 * should be witnessed and certified for the drug inspector. This module carries
 * the pure ITC arithmetic and builds the printable destruction certificate; the
 * stock side reuses the verified `adjust_stock` RPC (reason='writeoff').
 *
 * Note: feeding the reversal into GSTR-3B as a structured ITC-reversal line is a
 * GST-module concern — here the amount is computed, shown, recorded on the
 * write-off movement note, and printed on the certificate.
 */
import { formatPaise } from "./currency";

/**
 * ITC to reverse on destroyed goods: the GST originally claimed on their cost.
 * PTR is tax-exclusive, so reversal = qty × ptr × rate/100 (rounded to paise).
 */
export function itcReversalPaise(qty: number, ptrPaise: number, gstRate: number): number {
  return Math.round(qty * ptrPaise * (gstRate / 100));
}

export interface DestructionLine {
  name: string;
  batchNo: string;
  expiry: string;
  qty: number;
  costPaise: number; // qty × ptr
  itcPaise: number; // ITC reversal for the line
}

export interface DestructionCertificate {
  shopName: string;
  shopAddress: string | null;
  gstin: string | null;
  dateTime: string;
  method: string;
  witnessName: string;
  witnessDesignation: string;
  lines: DestructionLine[];
  totalUnits: number;
  totalCostPaise: number;
  totalItcPaise: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lineRow(l: DestructionLine): string {
  return `<tr>
    <td class="l">${esc(l.name)}</td>
    <td class="l">${esc(l.batchNo || "—")}</td>
    <td class="l">${esc(l.expiry || "—")}</td>
    <td class="r">${l.qty}</td>
    <td class="r">${formatPaise(l.costPaise)}</td>
    <td class="r">${formatPaise(l.itcPaise)}</td>
  </tr>`;
}

/** Build the destruction-certificate HTML (self-contained, A4, inline styles for print). */
export function destructionHtml(d: DestructionCertificate): string {
  const shopMeta = [d.shopAddress, d.gstin && `GSTIN: ${d.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Destruction Certificate</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; max-width: 180mm; margin: 0 auto; }
  .head { text-align: center; margin-bottom: 14px; }
  .head h1 { margin: 0; font-size: 17px; }
  .head .meta { font-size: 11px; color: #333; }
  h2 { font-size: 14px; text-align: center; letter-spacing: .04em; text-transform: uppercase; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; margin: 14px 0; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th { font-size: 10px; text-transform: uppercase; color: #444; border-bottom: 1.5px solid #000; padding: 5px 4px; }
  td { padding: 5px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th.r, td.r { text-align: right; }
  th.l, td.l { text-align: left; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #000; border-bottom: none; }
  .decl { font-size: 11px; margin: 14px 0; }
  .sign { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign div { width: 45%; border-top: 1px solid #000; padding-top: 4px; font-size: 11px; text-align: center; }
</style></head>
<body>
  <div class="head">
    <h1>${esc(d.shopName)}</h1>
    <div class="meta">${shopMeta}</div>
  </div>
  <h2>Certificate of Destruction of Expired Drugs</h2>
  <div class="row"><span><strong>Date:</strong> ${esc(d.dateTime)}</span><span><strong>Method:</strong> ${esc(d.method)}</span></div>
  <table>
    <thead><tr>
      <th class="l">Item</th><th class="l">Batch</th><th class="l">Expiry</th>
      <th class="r">Qty</th><th class="r">Cost value</th><th class="r">ITC reversed</th>
    </tr></thead>
    <tbody>${d.lines.map(lineRow).join("")}</tbody>
    <tfoot><tr>
      <td class="l" colspan="3">Total</td>
      <td class="r">${d.totalUnits}</td>
      <td class="r">${formatPaise(d.totalCostPaise)}</td>
      <td class="r">${formatPaise(d.totalItcPaise)}</td>
    </tr></tfoot>
  </table>
  <p class="decl">Certified that the drugs listed above have expired and were destroyed in the manner stated,
  in the presence of the witness named below. The input tax credit of <strong>${formatPaise(d.totalItcPaise)}</strong>
  attributable to these goods is reversed under Section 17(5)(h) of the CGST Act, 2017.</p>
  <div class="sign">
    <div>Witness: ${esc(d.witnessName || "")}${d.witnessDesignation ? `<br>${esc(d.witnessDesignation)}` : ""}</div>
    <div>For ${esc(d.shopName)}<br>(Pharmacist / Authorised signatory)</div>
  </div>
  <script>window.onload=function(){window.focus();window.print();};</script>
</body></html>`;
}

/** Open the destruction certificate in a new window and trigger the print dialog. */
export function printDestructionCertificate(d: DestructionCertificate): void {
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return; // popup blocked — destruction is already recorded; can reprint
  w.document.write(destructionHtml(d));
  w.document.close();
}
