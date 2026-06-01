import { supabase } from "../supabase";
import {
  DEFAULT_FORMAT as DEFAULT_DB_FORMAT,
  DEFAULT_INVOICE_TEMPLATE,
  normalizeFormat,
  normalizeTemplate,
  type InvoiceTemplate,
  type PrintFormat as DbPrintFormat,
} from "../printTemplate";
import { DEFAULT_FORMAT } from "./format";
import type { PrintFormat } from "./types";

/**
 * The print-relevant projection of the org's settings-authored default invoice
 * template (`print_templates`, doc_type=sales_invoice, is_default — authored in
 * Settings → Print templates, SALT-089). This is what makes the settings screen
 * actually change printed bills (SALT-165). It is *distinct* from the per-device
 * localStorage `PrintTemplate` (logo/licenses/signature, SALT-095): the DB row is
 * the org default; localStorage is a device-level override layered on top.
 */
export interface InvoiceConfig {
  /** Paper format the org chose, mapped to the print module's format ids. */
  format: PrintFormat;
  /** Print the shop GSTIN in the header. */
  showGstin: boolean;
  /** Print batch no. + expiry under each line. */
  showBatchExpiry: boolean;
  /** Copies to print (1–3). */
  copies: number;
  /** Tagline under the shop name ("" = none). */
  tagline: string;
  /** Footer / thank-you line. */
  footerText: string;
  /** Terms / jurisdiction line ("" = none). */
  termsText: string;
}

/** Map the DB format + thermal width onto the print module's four format ids. */
export function dbFormatToPrintFormat(format: DbPrintFormat, thermalWidth: 58 | 80): PrintFormat {
  if (format === "a4") return "a4";
  if (format === "dotmatrix") return "dotmatrix";
  return thermalWidth === 58 ? "thermal58" : "thermal80";
}

/** Project a stored DB template (+ format) into the print config. */
export function toInvoiceConfig(tpl: InvoiceTemplate, format: DbPrintFormat): InvoiceConfig {
  return {
    format: dbFormatToPrintFormat(format, tpl.thermal_width),
    showGstin: tpl.show_gstin,
    showBatchExpiry: tpl.show_batch_expiry,
    copies: tpl.copies,
    tagline: tpl.header_tagline,
    footerText: tpl.footer_text,
    termsText: tpl.terms_text,
  };
}

/** The built-in config used until a DB template is fetched (mirrors today's layout). */
export const DEFAULT_INVOICE_CONFIG: InvoiceConfig = {
  ...toInvoiceConfig(DEFAULT_INVOICE_TEMPLATE, DEFAULT_DB_FORMAT),
  format: DEFAULT_FORMAT, // the print module's own default (thermal80)
};

/** Whether the footer text is still the built-in default (so we can keep it bilingual). */
export const DEFAULT_FOOTER_TEXT = DEFAULT_INVOICE_TEMPLATE.footer_text;

let cached: InvoiceConfig | null = null;
let inflight: Promise<InvoiceConfig> | null = null;

/** The config if already fetched this session, else null (used for a sync first guess). */
export function cachedInvoiceConfig(): InvoiceConfig | null {
  return cached;
}

/**
 * Fetch the org's default sales-invoice template once and cache it. RLS scopes
 * `print_templates` to the caller's org(s), so no org id is needed at the call
 * site — a single-org user gets their one default row. Any failure (offline, no
 * row, not configured) resolves to the built-in default, so printing never breaks.
 */
export function loadInvoiceConfig(): Promise<InvoiceConfig> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    if (!supabase) return DEFAULT_INVOICE_CONFIG;
    try {
      const { data } = await supabase
        .from("print_templates")
        .select("format,template")
        .eq("doc_type", "sales_invoice")
        .eq("is_default", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const cfg = data
        ? toInvoiceConfig(normalizeTemplate(data.template), normalizeFormat(data.format))
        : DEFAULT_INVOICE_CONFIG;
      cached = cfg;
      return cfg;
    } catch {
      return DEFAULT_INVOICE_CONFIG;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Warm the cache ahead of the first print (optional; printing also primes it lazily). */
export function primeInvoiceConfig(): void {
  void loadInvoiceConfig();
}

/** Drop the cache so the next print re-reads the DB (call after the template is edited). */
export function invalidateInvoiceConfig(): void {
  cached = null;
  inflight = null;
}
