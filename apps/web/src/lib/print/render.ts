import type { InvoicePrintData, InvoiceLine, PrintFormat } from "./types";
import { formatPaise, splitInclusiveGst } from "../currency";
import { PAGE_RULE, PRINT_FORMATS, FORMAT_LABEL, FORMAT_WIDTH, FORMAT_LAYOUT } from "./format";
import { FORMAT_KEY, LANG_KEY } from "./prefs";
import { stateName } from "../stateCodes";
import { rupeesInWords } from "./words";
import { taxSummary } from "./taxSummary";
import { DOC_META, SALE_DOC_TYPES, type DocMeta, type DocType } from "./docType";
import { templateStorageKey, type PrintTemplate } from "./template";
import { pick, LABELS, LANG_LABEL, PRINT_LANGS, type PrintLang, type LabelKey } from "./i18n";
import { type InvoiceConfig, DEFAULT_FOOTER_TEXT } from "./invoiceConfig";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A bilingual label span: carries both languages so the popup can switch live. */
const L = (key: LabelKey, lang: PrintLang): string =>
  `<span class="i18n" data-en="${esc(LABELS[key].en)}" data-hi="${esc(LABELS[key].hi)}">${esc(pick(key, lang))}</span>`;

/** A per-shop template text node, hidden until it has a value (so the live editor can reveal it). */
const tplText = (field: string, val: string | undefined, tag = "div", extra = ""): string =>
  `<${tag} class="tpl-${field}${extra}"${val ? "" : ' style="display:none"'}>${esc(val ?? "")}</${tag}>`;

const tplLogo = (logo: string | undefined): string =>
  `<img class="tpl-logo" alt=""${logo ? ` src="${logo.replace(/"/g, "&quot;")}"` : ' style="display:none"'}>`;

const plainInr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Rupees without the ₹ glyph — many dot-matrix / impact printer fonts can't render it. */
const rs = (paise: number): string => plainInr.format(paise / 100);

const padR = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const padL = (s: string, n: number): string => (s.length >= n ? s.slice(s.length - n) : " ".repeat(n - s.length) + s);

/** Per-line discount, recovered from gross (MRP × qty) minus the net charged. */
const lineDisc = (l: InvoiceLine): number => l.mrpPaise * l.qty - l.netPaise;

// ─────────────────────────────────────────── receipt (thermal 58 / 80 mm)

function receiptLineRow(l: InvoiceLine, showBatchExpiry: boolean): string {
  const sub = [l.pack, showBatchExpiry && l.batchNo && `B: ${l.batchNo}`, showBatchExpiry && l.expiry && `Exp ${l.expiry}`]
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

// `label` is rendered as raw HTML (callers pass bilingual <span> labels, never user data).
function receiptTotalRow(label: string, value: string, strong = false): string {
  return `<tr class="${strong ? "tot" : ""}"><td colspan="3" class="r">${label}</td><td class="r">${esc(value)}</td></tr>`;
}

function receiptBody(d: InvoicePrintData, meta: DocMeta, t: PrintTemplate, lang: PrintLang, cfg: InvoiceConfig): string {
  const tagline = t.tagline ?? cfg.tagline;
  const terms = t.terms ?? cfg.termsText;
  const shopMeta = [
    d.shop.address,
    d.shop.phone && `Ph: ${d.shop.phone}`,
    cfg.showGstin && d.shop.gstin && `GSTIN: ${d.shop.gstin}`,
  ]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join("<br>");
  const custMeta = [d.customer?.phone, d.customer?.gstin && `GSTIN: ${d.customer.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  const taxRows = d.isInterstate
    ? receiptTotalRow(L("igst", lang), formatPaise(d.igst))
    : receiptTotalRow(L("cgst", lang), formatPaise(d.cgst)) + receiptTotalRow(L("sgst", lang), formatPaise(d.sgst));
  const payLabel = d.payment.method === "credit" ? "Credit" : "Cash";
  const refLine = d.reference ? `<div class="note-only ref">${esc(d.reference)}</div>` : "";
  // Footer: a bilingual "thank you" when left at the default, else the custom text verbatim.
  const footer = cfg.footerText === DEFAULT_FOOTER_TEXT ? L("thankYou", lang) : esc(cfg.footerText);
  return `<div class="receipt">
    <div class="shop">${tplLogo(t.logo)}<h1>${esc(d.shop.name)}</h1>${tplText("tagline", tagline)}<div class="meta">${shopMeta}</div>${tplText("licenses", t.licenses, "div", " meta")}</div>
    <hr>
    <div class="row"><span class="doctitle">${esc(meta.title)}</span><span>${esc(d.dateTime)}</span></div>
    <div class="row"><span>${L("ref", lang)}: ${esc(d.ref)}</span><span>${esc(payLabel)}</span></div>
    ${refLine}
    <div class="bill-to"><strong>${esc(d.customerName)}</strong>${custMeta ? `<br><span class="meta">${custMeta}</span>` : ""}</div>
    <table>
      <thead><tr><th class="l">${L("item", lang)}</th><th class="r">${L("qty", lang)}</th><th class="r">${L("mrp", lang)}</th><th class="r">${L("amt", lang)}</th></tr></thead>
      <tbody>${d.lines.map((l) => receiptLineRow(l, cfg.showBatchExpiry)).join("")}</tbody>
      <tfoot>
        ${receiptTotalRow(L("grossMrp", lang), formatPaise(d.gross))}
        ${d.discount > 0 ? receiptTotalRow(L("discount", lang), `- ${formatPaise(d.discount)}`) : ""}
        ${d.billDiscount > 0 ? receiptTotalRow(L("billDiscount", lang), `- ${formatPaise(d.billDiscount)}`) : ""}
        ${receiptTotalRow(L("taxable", lang), formatPaise(d.taxable))}
        ${taxRows}
        ${receiptTotalRow(L("total", lang), formatPaise(d.grand), true)}
      </tfoot>
    </table>
    <div class="words">${esc(rupeesInWords(d.grand))}</div>
    ${tplText("terms", terms)}
    <div class="foot">${footer}</div>
    ${tplText("footer", t.footer)}
  </div>`;
}

// ─────────────────────────────────────────── sheet (A4)

function sheetItemRow(l: InvoiceLine, i: number, showBatchExpiry: boolean): string {
  const { taxable } = splitInclusiveGst(l.netPaise, l.gstRate);
  const disc = lineDisc(l);
  const sub = [showBatchExpiry && l.batchNo && `B: ${l.batchNo}`, showBatchExpiry && l.expiry && `Exp ${l.expiry}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  return `<tr>
    <td class="r">${i + 1}</td>
    <td>${esc(l.name)}<div class="sub">${esc(l.pack)}${sub ? ` · ${sub}` : ""}</div></td>
    <td>${esc(l.hsn ?? "")}</td>
    <td class="r">${l.qty}</td>
    <td class="r">${formatPaise(l.mrpPaise)}</td>
    <td class="r">${disc > 0 ? formatPaise(disc) : "-"}</td>
    <td class="r">${formatPaise(taxable)}</td>
    <td class="r">${l.gstRate}%</td>
    <td class="r">${formatPaise(l.netPaise)}</td>
  </tr>`;
}

function sheetBody(d: InvoicePrintData, meta: DocMeta, t: PrintTemplate, lang: PrintLang, cfg: InvoiceConfig): string {
  const tagline = t.tagline ?? cfg.tagline;
  const terms = t.terms ?? cfg.termsText;
  const shopLines = [d.shop.address, d.shop.phone && `Ph: ${d.shop.phone}`]
    .filter(Boolean)
    .map((s) => `<div>${esc(String(s))}</div>`)
    .join("");
  const custLines = [d.customer?.phone, d.customer?.gstin && `GSTIN: ${d.customer.gstin}`]
    .filter(Boolean)
    .map((s) => esc(String(s)))
    .join(" · ");
  const posCode = d.customer?.state_code ?? d.shop.state_code;
  const posName = stateName(posCode);
  const supply = `${posName || "-"}${posCode ? ` (${esc(posCode)})` : ""} · ${d.isInterstate ? "Inter-state" : "Intra-state"}`;
  const taxRows = d.isInterstate
    ? `<tr><td>${L("igst", lang)}</td><td>${formatPaise(d.igst)}</td></tr>`
    : `<tr><td>${L("cgst", lang)}</td><td>${formatPaise(d.cgst)}</td></tr><tr><td>${L("sgst", lang)}</td><td>${formatPaise(d.sgst)}</td></tr>`;
  const payLabel = d.payment.method === "credit" ? `Credit (${d.payment.creditDays} days)` : "Cash";
  // Rate-wise tax breakup (rule 46) — taxable + tax per GST slab.
  const tax = taxSummary(d.lines, d.isInterstate);
  const taxHead = d.isInterstate
    ? `<tr><th class="r">${L("taxable", lang)}</th><th class="r">${L("rate", lang)}</th><th class="r">${L("igst", lang)}</th></tr>`
    : `<tr><th class="r">${L("taxable", lang)}</th><th class="r">${L("rate", lang)}</th><th class="r">${L("cgst", lang)}</th><th class="r">${L("sgst", lang)}</th></tr>`;
  const taxBody = tax
    .map((r) =>
      d.isInterstate
        ? `<tr><td class="r">${formatPaise(r.taxable)}</td><td class="r">${r.rate}%</td><td class="r">${formatPaise(r.igst)}</td></tr>`
        : `<tr><td class="r">${formatPaise(r.taxable)}</td><td class="r">${r.rate}%</td><td class="r">${formatPaise(r.cgst)}</td><td class="r">${formatPaise(r.sgst)}</td></tr>`,
    )
    .join("");
  return `<div class="sheet">
    <div class="s-head">
      <div class="s-shop">
        ${tplLogo(t.logo)}
        <h1>${esc(d.shop.name)}</h1>
        ${tplText("tagline", tagline)}
        ${shopLines}
        ${cfg.showGstin && d.shop.gstin ? `<div><strong>GSTIN: ${esc(d.shop.gstin)}</strong></div>` : ""}
        ${tplText("licenses", t.licenses)}
      </div>
      <div class="s-title">
        <div class="s-doctype doctitle">${esc(meta.title)}</div>
        <div class="s-tag b2b-only">B2B</div>
        <div class="s-copy taxdoc-only">Original for Recipient</div>
        <table class="s-meta">
          <tr><td>${L("number", lang)}</td><td>${esc(d.ref)}</td></tr>
          <tr><td>${L("date", lang)}</td><td>${esc(d.dateTime)}</td></tr>
          <tr><td>${L("payment", lang)}</td><td>${esc(payLabel)}</td></tr>
          <tr class="taxdoc-only"><td>${L("reverseCharge", lang)}</td><td>No</td></tr>
        </table>
      </div>
    </div>
    <div class="s-billto">
      <div><span class="lbl">${L("billTo", lang)}</span><strong>${esc(d.customerName)}</strong>${custLines ? `<div class="sub">${custLines}</div>` : ""}${d.reference ? `<div class="sub note-only">${esc(d.reference)}</div>` : ""}</div>
      <div><span class="lbl">${L("placeOfSupply", lang)}</span>${supply}</div>
    </div>
    <table class="s-items">
      <thead><tr>
        <th class="r">#</th><th>${L("item", lang)}</th><th>${L("hsn", lang)}</th><th class="r">${L("qty", lang)}</th>
        <th class="r">${L("mrp", lang)}</th><th class="r">${L("disc", lang)}</th><th class="r">${L("taxable", lang)}</th><th class="r">${L("gst", lang)}</th><th class="r">${L("amount", lang)}</th>
      </tr></thead>
      <tbody>${d.lines.map((l, i) => sheetItemRow(l, i, cfg.showBatchExpiry)).join("")}</tbody>
    </table>
    <div class="s-bottom">
      <div class="s-notes">
        <div class="s-cap">${L("taxSummary", lang)}</div>
        <table class="s-tax"><thead>${taxHead}</thead><tbody>${taxBody}</tbody></table>
      </div>
      <table class="s-totals">
        <tr><td>${L("grossMrp", lang)}</td><td>${formatPaise(d.gross)}</td></tr>
        ${d.discount > 0 ? `<tr><td>${L("discount", lang)}</td><td>- ${formatPaise(d.discount)}</td></tr>` : ""}
        ${d.billDiscount > 0 ? `<tr><td>${L("billDiscount", lang)}</td><td>- ${formatPaise(d.billDiscount)}</td></tr>` : ""}
        <tr><td>${L("taxableValue", lang)}</td><td>${formatPaise(d.taxable)}</td></tr>
        ${taxRows}
        <tr class="grand"><td>${L("grandTotal", lang)}</td><td>${formatPaise(d.grand)}</td></tr>
      </table>
    </div>
    <div class="s-words"><span class="lbl">${L("amountInWords", lang)}</span>${esc(rupeesInWords(d.grand))}</div>
    ${tplText("terms", terms)}
    <div class="s-foot-row">
      <div class="s-decl taxdoc-only">${L("declaration", lang)}</div>
      <div class="s-sign">For ${esc(d.shop.name)}<div class="s-sign-line"><span class="tpl-signatureLabel">${esc(t.signatureLabel ?? "Authorised signatory")}</span></div></div>
    </div>
    ${tplText("footer", t.footer ?? (cfg.footerText === DEFAULT_FOOTER_TEXT ? undefined : cfg.footerText))}
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
/** Greedy word-wrap to the monospace width — keeps the amount-in-words on the form. */
function monoWrap(s: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if (line && line.length + 1 + w.length > MONO_W) {
      out.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) out.push(line);
  return out;
}

function monoBody(d: InvoicePrintData, meta: DocMeta, t: PrintTemplate, cfg: InvoiceConfig): string {
  const tagline = t.tagline ?? cfg.tagline;
  const terms = t.terms ?? cfg.termsText;
  const footer = t.footer ?? (cfg.footerText || "Thank you. Get well soon.");
  const lines: string[] = [];
  lines.push(monoCenter(d.shop.name.toUpperCase()));
  if (tagline) lines.push(monoCenter(tagline));
  if (d.shop.address) lines.push(monoCenter(d.shop.address));
  const idLine = [d.shop.phone && `Ph: ${d.shop.phone}`, cfg.showGstin && d.shop.gstin && `GSTIN: ${d.shop.gstin}`]
    .filter(Boolean)
    .join("  ");
  if (idLine) lines.push(monoCenter(idLine));
  if (t.licenses) for (const wl of monoWrap(t.licenses)) lines.push(monoCenter(wl));
  lines.push(monoRule);
  lines.push(monoSplit(`No: ${d.ref}`, `Date: ${d.dateTime}`));
  lines.push(`Customer: ${d.customerName}`);
  if (d.customer?.gstin) lines.push(`GSTIN   : ${d.customer.gstin}`);
  if (d.reference) for (const wl of monoWrap(d.reference)) lines.push(wl);
  lines.push(monoDash);
  lines.push(padR("Item", 30) + " " + padL("Qty", 5) + " " + padL("MRP", 11) + " " + padL("Amount", 12));
  lines.push(monoDash);
  for (const l of d.lines) {
    lines.push(padR(l.name, 30) + " " + padL(String(l.qty), 5) + " " + padL(rs(l.mrpPaise), 11) + " " + padL(rs(l.netPaise), 12));
    const sub = [l.pack, cfg.showBatchExpiry && l.batchNo && `B:${l.batchNo}`, cfg.showBatchExpiry && l.expiry && `Exp ${l.expiry}`].filter(Boolean).join("  ");
    if (sub) lines.push(padR("  " + sub, MONO_W));
  }
  lines.push(monoDash);
  lines.push(monoTotal("Gross (MRP)", rs(d.gross)));
  if (d.discount > 0) lines.push(monoTotal("Discount", "-" + rs(d.discount)));
  if (d.billDiscount > 0) lines.push(monoTotal("Bill discount", "-" + rs(d.billDiscount)));
  lines.push(monoTotal("Taxable", rs(d.taxable)));
  if (d.isInterstate) {
    lines.push(monoTotal("IGST", rs(d.igst)));
  } else {
    lines.push(monoTotal("CGST", rs(d.cgst)));
    lines.push(monoTotal("SGST", rs(d.sgst)));
  }
  lines.push(monoTotal("TOTAL", rs(d.grand)));
  lines.push("");
  for (const wl of monoWrap(rupeesInWords(d.grand))) lines.push(wl);
  if (terms) {
    lines.push("");
    for (const wl of monoWrap(terms)) lines.push(wl);
  }
  lines.push(monoRule);
  lines.push(monoCenter(footer));
  return `<div class="mono-title doctitle">${esc(meta.title)}</div><pre class="mono">${esc(lines.join("\n"))}</pre>`;
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
.toolbar .sep{width:1px;height:20px;background:#e4e4e7;margin:0 4px}
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
.receipt .words{font-size:9px;color:#444;margin-top:5px;text-align:center}
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
.sheet .s-copy{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
.sheet .s-cap{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.04em;margin-bottom:3px}
.sheet table.s-tax{border-collapse:collapse;font-size:11px;min-width:260px}
.sheet table.s-tax th{background:#f4f4f5;border:1px solid #d4d4d8;padding:3px 8px;font-size:10px;text-transform:uppercase;color:#555}
.sheet table.s-tax td{border:1px solid #e4e4e7;padding:3px 8px}
.sheet table.s-tax .r{text-align:right}
.sheet .s-words{margin-top:10px;font-size:12px}
.sheet .s-words .lbl{display:block;font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.04em}
.sheet .s-foot-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px}
.sheet .s-decl{font-size:10px;color:#666;max-width:55%;font-style:italic}
.sheet .s-sign{text-align:right;font-size:11px}
.sheet .s-sign-line{margin-top:26px;border-top:1px solid #888;display:inline-block;padding-top:3px;color:#555}
/* mono */
.mono{font-family:"Courier New",monospace;font-size:12px;line-height:1.35;white-space:pre;color:#000;margin:0}
.mono-title{font-family:"Courier New",monospace;text-align:center;font-weight:700;font-size:13px;letter-spacing:.08em;margin:0 0 4px}
/* document-type variants */
.receipt .ref{font-size:10px;color:#444;margin:2px 0}
.sheet .s-tag{display:inline-block;font-size:10px;font-weight:700;color:#2563eb;border:1px solid #2563eb;border-radius:4px;padding:0 5px;margin-bottom:6px}
.note-only,.b2b-only{display:none}
body[data-doctype="b2b-invoice"] .b2b-only{display:inline-block}
body[data-doctype="credit-note"] .note-only,
body[data-doctype="debit-note"] .note-only,
body[data-doctype="sales-return"] .note-only{display:block}
body[data-doctype="cash-memo"] .taxdoc-only,
body[data-doctype="sales-return"] .taxdoc-only{display:none}
/* per-shop template elements */
.tpl-logo{max-height:48px;max-width:70%;margin:0 auto 4px;display:block;object-fit:contain}
.sheet .tpl-logo{margin:0 0 6px}
.tpl-tagline{font-size:11px;color:#444}
.receipt .tpl-tagline{font-size:10px}
.tpl-licenses{font-size:10px;color:#555}
.tpl-footer{margin-top:4px;font-size:10px;color:#444;text-align:center}
.tpl-terms{margin-top:6px;font-size:9px;color:#666;white-space:pre-wrap}
.sheet .tpl-terms{font-size:10px;max-width:62%}
/* template editor (screen only) */
.tpl-editor{max-width:760px;margin:8px auto 0;padding:10px 12px;border:1px solid #d4d4d8;border-radius:8px;background:#fff;font-size:12px}
.tpl-editor .tpl-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tpl-editor label{width:92px;color:#71717a;flex:none}
.tpl-editor input,.tpl-editor textarea{flex:1;font:inherit;padding:4px 6px;border:1px solid #d4d4d8;border-radius:5px;min-width:0}
.tpl-editor .tpl-note{color:#a1a1aa;font-size:11px;margin-top:2px}
/* copies: a page break between repeated bodies; a faint rule on screen */
.copy-break{break-before:page;border-top:1px dashed #d4d4d8;margin:14px 0}
@media print{
  body{background:#fff;padding:0}
  .toolbar,.tpl-editor{display:none!important}
  .doc{box-shadow:none;margin:0;padding:0;width:auto!important}
  .copy-break{border:none;margin:0}
}`;

/**
 * Inline controller for the print popup: switches format (re-targets the `@page`
 * paper + swaps which layout shows), remembers the choice in this origin's
 * localStorage, and auto-fires the print dialog on load so the F9 fast path is
 * unchanged. The popup is left open so the operator can re-print in another
 * format. Written without template-literal syntax so it survives interpolation.
 */
const DOC_TITLES = Object.fromEntries((Object.keys(DOC_META) as DocType[]).map((t) => [t, DOC_META[t].title]));

const SCRIPT = `(function(){
var FMT=${JSON.stringify(PAGE_RULE)};
var KEY=${JSON.stringify(FORMAT_KEY)};
var LANGKEY=${JSON.stringify(LANG_KEY)};
var TITLES=${JSON.stringify(DOC_TITLES)};
function setActive(sel,attr,val){
  var bs=document.querySelectorAll(sel);
  for(var i=0;i<bs.length;i++){bs[i].className=bs[i].getAttribute(attr)===val?"on":"";}
}
function setFormat(f){
  if(!FMT[f])return;
  document.body.setAttribute("data-format",f);
  document.getElementById("pagestyle").textContent=FMT[f];
  try{localStorage.setItem(KEY,f);}catch(e){}
  setActive(".toolbar [data-f]","data-f",f);
}
function setDoc(t){
  if(!TITLES[t])return;
  document.body.setAttribute("data-doctype",t);
  var ts=document.querySelectorAll(".doctitle");
  for(var i=0;i<ts.length;i++){ts[i].textContent=TITLES[t];}
  setActive(".toolbar [data-d]","data-d",t);
}
function setLang(l){
  document.body.setAttribute("data-lang",l);
  try{localStorage.setItem(LANGKEY,l);}catch(e){}
  var es=document.querySelectorAll(".i18n");
  for(var i=0;i<es.length;i++){var en=es[i].getAttribute("data-en")||"";var hi=es[i].getAttribute("data-hi")||"";es[i].textContent=(l==="hi")?hi:((l==="both")?(en+" / "+hi):en);}
  setActive(".toolbar [data-l]","data-l",l);
}
function wire(sel,attr,fn){
  var bs=document.querySelectorAll(sel);
  for(var i=0;i<bs.length;i++){(function(b){b.onclick=function(){fn(b.getAttribute(attr));};})(bs[i]);}
}
wire(".toolbar [data-f]","data-f",setFormat);
wire(".toolbar [data-d]","data-d",setDoc);
wire(".toolbar [data-l]","data-l",setLang);
var TPL=(window.__TPL||{});
var TPL_KEY=(window.__TPL_KEY||"salt.print.template:default");
function saveTpl(){try{localStorage.setItem(TPL_KEY,JSON.stringify(TPL));}catch(e){}}
function applyText(field,val){
  if(val){TPL[field]=val;}else{delete TPL[field];}
  saveTpl();
  var els=document.querySelectorAll(".tpl-"+field);
  for(var i=0;i<els.length;i++){els[i].textContent=val;if(field!=="signatureLabel"){els[i].style.display=val?"":"none";}}
}
var tins=document.querySelectorAll(".tpl-editor [data-tpl]");
for(var ti=0;ti<tins.length;ti++){(function(inp){inp.oninput=function(){applyText(inp.getAttribute("data-tpl"),inp.value);};})(tins[ti]);}
var logoIn=document.getElementById("tpl-logo-input");
if(logoIn)logoIn.onchange=function(){
  var f=this.files&&this.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){TPL.logo=String(rd.result);saveTpl();var ls=document.querySelectorAll(".tpl-logo");for(var i=0;i<ls.length;i++){ls[i].src=TPL.logo;ls[i].style.display="";}};
  rd.readAsDataURL(f);
};
var cust=document.getElementById("customise");var panel=document.getElementById("tpl-editor");
if(cust&&panel)cust.onclick=function(){panel.style.display=panel.style.display==="none"?"block":"none";};
var go=document.getElementById("go");if(go)go.onclick=function(){window.print();};
var cl=document.getElementById("close");if(cl)cl.onclick=function(){window.close();};
window.onload=function(){window.focus();window.print();};
})();`;

/** The screen-only per-shop template editor (logo / tagline / license / footer / terms / signature). */
function editorPanel(t: PrintTemplate): string {
  const field = (key: keyof PrintTemplate, label: string, val: string | undefined) =>
    `<div class="tpl-row"><label>${label}</label><input data-tpl="${key}" value="${esc(val ?? "")}"></div>`;
  return `<div class="tpl-editor" id="tpl-editor" style="display:none">
  <div class="tpl-row"><label>Logo</label><input type="file" id="tpl-logo-input" accept="image/*"></div>
  ${field("tagline", "Tagline", t.tagline)}
  ${field("licenses", "License no.", t.licenses)}
  ${field("footer", "Footer", t.footer)}
  <div class="tpl-row"><label>Terms</label><textarea data-tpl="terms" rows="2">${esc(t.terms ?? "")}</textarea></div>
  ${field("signatureLabel", "Signature", t.signatureLabel ?? "Authorised signatory")}
  <div class="tpl-note">Saved on this device for this shop · applies to every bill</div>
</div>`;
}

/** Repeat one rendered body `copies` times, page-breaking between copies. */
function withCopies(body: string, copies: number): string {
  if (copies <= 1) return body;
  return Array.from({ length: copies }, (_, i) => (i === 0 ? body : `<div class="copy-break"></div>${body}`)).join("");
}

/** Build the invoice HTML document (self-contained, inline styles, all formats). */
export function invoiceHtml(
  d: InvoicePrintData,
  opts: { format: PrintFormat; docType: DocType; template: PrintTemplate; lang: PrintLang; config: InvoiceConfig },
): string {
  const { format: fmt, docType, template, lang, config } = opts;
  const meta = DOC_META[docType];
  const copies = config.copies;
  const fmtButtons = PRINT_FORMATS.map(
    (f) => `<button data-f="${f}"${f === fmt ? ' class="on"' : ""}>${esc(FORMAT_LABEL[f])}</button>`,
  ).join("");
  const langButtons =
    `<span class="sep"></span><span class="lbl">Lang</span>` +
    PRINT_LANGS.map(
      (l) => `<button data-l="${l}"${l === lang ? ' class="on"' : ""}>${esc(LANG_LABEL[l])}</button>`,
    ).join("");
  // The document switcher is offered only for forward-sale documents the cashier
  // may legitimately re-pick at print time; notes/returns come fixed from the caller.
  const docButtons = (SALE_DOC_TYPES as readonly DocType[]).includes(docType)
    ? `<span class="sep"></span><span class="lbl">Document</span>` +
      SALE_DOC_TYPES.map(
        (t) => `<button data-d="${t}"${t === docType ? ' class="on"' : ""}>${esc(DOC_META[t].label)}</button>`,
      ).join("")
    : "";
  // Escape "<" so a stray "</script>" inside a template field can't close the tag.
  const j = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const dataScript = `<script>window.__TPL=${j(template)};window.__TPL_KEY=${j(templateStorageKey(d.shop.id))};</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.title)} ${esc(d.ref)}</title>
<style id="pagestyle">${PAGE_RULE[fmt]}</style>
<style>${STYLE}</style></head>
<body data-format="${fmt}" data-doctype="${docType}" data-lang="${lang}">
<div class="toolbar">
  <span class="lbl">Format</span>${fmtButtons}${docButtons}${langButtons}
  <span class="spacer"></span>
  <button id="customise">Customise</button>
  <button id="go" class="go">Print</button>
  <button id="close">Close</button>
</div>
${editorPanel(template)}
<div class="doc" id="doc-receipt">${withCopies(receiptBody(d, meta, template, lang, config), copies)}</div>
<div class="doc" id="doc-sheet">${withCopies(sheetBody(d, meta, template, lang, config), copies)}</div>
<div class="doc" id="doc-mono">${withCopies(monoBody(d, meta, template, config), copies)}</div>
${dataScript}
<script>${SCRIPT}</script>
</body></html>`;
}
