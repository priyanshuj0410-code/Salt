import { invoiceHtml } from "./render";
import { loadDefaultLang } from "./prefs";
import { deriveDocType } from "./docType";
import { loadTemplate } from "./template";
import {
  cachedInvoiceConfig,
  loadInvoiceConfig,
  DEFAULT_INVOICE_CONFIG,
  type InvoiceConfig,
} from "./invoiceConfig";
import type { InvoicePrintData, PrintOptions } from "./types";

export * from "./types";
export * from "./format";
export * from "./prefs";
export * from "./build";
export * from "./docType";
export * from "./template";
export * from "./i18n";
export * from "./invoiceConfig";
export { invoiceHtml } from "./render";

/** Render the print document into an already-open window for a resolved config. */
function fill(w: Window, d: InvoicePrintData, opts: PrintOptions, config: InvoiceConfig): void {
  // The saved org default picks the format; an explicit opts.format (a reprint in
  // a chosen format) still wins.
  const format = opts.format ?? config.format;
  const docType = opts.docType ?? deriveDocType(!!d.customer?.gstin);
  const lang = opts.lang ?? loadDefaultLang();
  const template = loadTemplate(d.shop.id);
  w.document.open();
  w.document.write(invoiceHtml(d, { format, docType, template, lang, config }));
  w.document.close();
}

/**
 * Open the invoice in a new window and trigger the browser print dialog. Paper,
 * header GSTIN, batch/expiry visibility, footer/terms and copies come from the
 * org's saved default template (Settings → Print templates, SALT-165); an
 * explicit `opts` (e.g. a reprint in a chosen format) overrides. The window is
 * opened **synchronously** so it is not popup-blocked, then filled once the
 * cached template resolves; the F9 fast path stays a single user action.
 */
export function printInvoice(d: InvoicePrintData, opts: PrintOptions = {}): void {
  // A fixed window name reuses one popup across bills (no pile-up at a busy
  // counter); the switchers keep it open for re-prints, so we reset its
  // document on each call rather than auto-closing after print.
  const w = window.open("", "salt-print", "width=520,height=760");
  if (!w) return; // popup blocked: the sale is already saved; user can reprint later
  const cached = cachedInvoiceConfig();
  if (cached) {
    fill(w, d, opts, cached);
    return;
  }
  // First print of the session: show a tiny placeholder, then fill once the
  // org template loads (falls back to the built-in default on any failure).
  w.document.open();
  w.document.write("<!doctype html><title>Preparing…</title><body style=\"font:13px sans-serif;padding:16px\">Preparing invoice…</body>");
  w.document.close();
  loadInvoiceConfig()
    .then((config) => {
      if (!w.closed) fill(w, d, opts, config);
    })
    .catch(() => {
      if (!w.closed) fill(w, d, opts, DEFAULT_INVOICE_CONFIG);
    });
}
