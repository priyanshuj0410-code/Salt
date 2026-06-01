import { invoiceHtml } from "./render";
import { loadDefaultFormat, loadDefaultLang } from "./prefs";
import { deriveDocType } from "./docType";
import { loadTemplate } from "./template";
import type { InvoicePrintData, PrintOptions } from "./types";

export * from "./types";
export * from "./format";
export * from "./prefs";
export * from "./build";
export * from "./docType";
export * from "./template";
export * from "./i18n";
export { invoiceHtml } from "./render";

/**
 * Open the invoice in a new window and trigger the browser print dialog. Format
 * defaults to the operator's saved preference (F9 Save & Print stays a one-shot);
 * document kind defaults to one derived from the sale (B2B when the buyer has a
 * GSTIN, else a plain tax invoice). The popup carries switchers to re-print in
 * another format or as a cash memo.
 */
export function printInvoice(d: InvoicePrintData, opts: PrintOptions = {}): void {
  const format = opts.format ?? loadDefaultFormat();
  const docType = opts.docType ?? deriveDocType(!!d.customer?.gstin);
  const lang = opts.lang ?? loadDefaultLang();
  const template = loadTemplate(d.shop.id);
  // A fixed window name reuses one popup across bills (no pile-up at a busy
  // counter); the switchers keep it open for re-prints, so we reset its
  // document on each call rather than auto-closing after print.
  const w = window.open("", "salt-print", "width=520,height=760");
  if (!w) return; // popup blocked — the sale is already saved; user can reprint later
  w.document.open();
  w.document.write(invoiceHtml(d, { format, docType, template, lang }));
  w.document.close();
}
