/**
 * Per-shop print customisation — the bits a chemist wants on every bill that
 * aren't core transaction data: a logo, a tagline under the shop name, the drug
 * license numbers (not on the `shops` record), a footer note, terms, and an
 * extra signature line (e.g. the pharmacist). Persisted in this origin's
 * localStorage keyed by shop, edited live in the print popup. See [SALT-095].
 */
export interface PrintTemplate {
  /** Logo as a data URL (kept small; stored inline). */
  logo?: string;
  /** A line printed under the shop name. */
  tagline?: string;
  /** Drug license numbers, e.g. "DL 20B: MH-NGP-12345 · 21B: MH-NGP-12346". */
  licenses?: string;
  /** Footer note, e.g. "Goods once sold will not be taken back except expiry." */
  footer?: string;
  /** Terms & conditions block (small print). */
  terms?: string;
  /** Label for an extra signature line (e.g. "Pharmacist"); blank = none. */
  signatureLabel?: string;
}

const KEY_PREFIX = "salt.print.template:";

/** The localStorage key for a shop's template (a stable fallback when shop is unknown). */
export function templateStorageKey(shopId: string | null | undefined): string {
  return KEY_PREFIX + (shopId || "default");
}

export function loadTemplate(shopId: string | null | undefined): PrintTemplate {
  try {
    const v = localStorage.getItem(templateStorageKey(shopId));
    if (v) return JSON.parse(v) as PrintTemplate;
  } catch {
    // unavailable / malformed — fall back to an empty template
  }
  return {};
}

export function saveTemplate(shopId: string | null | undefined, t: PrintTemplate): void {
  try {
    localStorage.setItem(templateStorageKey(shopId), JSON.stringify(t));
  } catch {
    // best-effort
  }
}
