/**
 * Stable entry point for the print module. The implementation lives in
 * `lib/print/*` (formats, per-shop templates, variants, bilingual labels); this
 * barrel preserves the `@/lib/printInvoice` import path used by the billing
 * checkout so the print pipeline can grow without touching call sites.
 */
export * from "./print";
