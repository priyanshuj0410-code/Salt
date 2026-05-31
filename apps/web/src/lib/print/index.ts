import { invoiceHtml } from "./render";
import { loadDefaultFormat } from "./prefs";
import type { InvoicePrintData, PrintOptions } from "./types";

export * from "./types";
export * from "./format";
export * from "./prefs";
export * from "./build";
export { invoiceHtml } from "./render";

/**
 * Open the invoice in a new window and trigger the browser print dialog. The
 * format defaults to the operator's saved preference (F9 Save & Print stays a
 * one-shot); the popup carries a switcher to re-print in any other format.
 */
export function printInvoice(d: InvoicePrintData, opts: PrintOptions = {}): void {
  const format = opts.format ?? loadDefaultFormat();
  // A fixed window name reuses one popup across bills (no pile-up at a busy
  // counter); the format switcher keeps it open for re-prints, so we reset its
  // document on each call rather than auto-closing after print.
  const w = window.open("", "salt-print", "width=480,height=760");
  if (!w) return; // popup blocked — the sale is already saved; user can reprint later
  w.document.open();
  w.document.write(invoiceHtml(d, { format }));
  w.document.close();
}
