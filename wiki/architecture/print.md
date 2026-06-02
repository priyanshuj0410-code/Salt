---
type: architecture
updated: 2026-06-02
tags: [print, counter, invoice, gst, compliance]
---

# Print module

How a saved sale becomes a physical document — the thermal/A4/dot-matrix invoices and challans a chemist hands the customer (a Drugs & Cosmetics Rules requirement, per [product-modules](../product/product-modules.md) §Counter — Print). The module is **render-only**: it turns an already-persisted invoice into HTML for the browser's print dialog and **computes no money** — every total is passed in from the server-side [`create_sales_invoice`](../domain/orders.md) write-path.

Lives entirely under `apps/web/src/lib/print/`. The billing checkout's import path `@/lib/printInvoice` is a thin re-export barrel over it, so the whole feature rides through one call — `printInvoice(d)` — and the [billing screen](billing-screen.md) call site never changed across six tickets.

## What it does (the six shipped tickets)

| Ticket | What shipped |
|---|---|
| **SALT-094** | The multi-format engine: one renderer → **thermal 58 mm, thermal 80 mm, A4, dot-matrix**, each with correct `@page` paper geometry. A screen-only **format switcher** in the print popup live-swaps the `@page` rule + remembers the choice; F9 Save & Print stays a one-shot. |
| **SALT-097** | The A4 sheet made a **CGST Rules rule-46-compliant tax invoice**: rate-wise tax summary, amount-in-words (Indian crore/lakh), place of supply + state name, reverse-charge field, copy label, declaration, HSN column. |
| **SALT-096** | **Bill variants** — `tax-invoice / cash-memo / b2b-invoice / credit-note / debit-note / sales-return`. Each drives the heading, whether rule-46 formalities show, a B2B tag, and a reference-to-original line. Derived from the sale (buyer GSTIN → B2B); popup switcher for the forward-sale trio. |
| **SALT-095** | **Per-shop template** (logo / tagline / drug-license numbers / footer / T&C / signature label), persisted per shop in **localStorage**, edited live via a "Customise" panel in the print popup. |
| **SALT-098** | **Bilingual labels** (English + Hindi + both): structural labels (column headers, totals, fixed phrases) translate via a dictionary and switch live on receipt + A4; data and the document title stay as captured. Dot-matrix stays English (Devanagari is not monospaced). |
| **SALT-165** | **Consume the org's settings-authored default**: read the default `sales_invoice` row from the `print_templates` DB table (written by Settings → Print templates) and apply paper/GSTIN/batch-expiry/footer/terms/copies. This is what makes the settings screen actually change printed bills. |

## Architecture

`printInvoice(d, opts?)` opens a named popup window (reused across bills — no pile-up at a busy counter), resolves the effective settings, writes a **self-contained HTML document** (inline styles + a small vanilla controller script), and auto-fires `window.print()`. The document contains **all three layout families at once** (`#doc-receipt`, `#doc-sheet`, `#doc-mono`); CSS keyed on `body[data-format]` shows the right one, so the switcher is instant and offline.

### File map (`apps/web/src/lib/print/`)

| File | Role |
|---|---|
| `index.ts` | `printInvoice` + public surface (the barrel target). Opens the window **synchronously** (so it isn't popup-blocked), then fills it once the async DB config resolves. |
| `render.ts` | The renderer: `invoiceHtml(d, {format, docType, template, lang, config})` → the three layouts (`receiptBody` / `sheetBody` / `monoBody`), the popup `STYLE` + controller `SCRIPT`, and the Customise editor panel. |
| `build.ts` | `buildInvoiceData(...)` — projects live bill state (lines, totals, party, shop) into the `InvoicePrintData` payload **before** `clear()` wipes it; `invoiceRef` (UUID → short handle). |
| `types.ts` | `PrintFormat`, `InvoicePrintData`, `InvoiceLine`, `ShopHeader`, `CustomerDetail`, `PrintOptions`. |
| `format.ts` | The format registry — `@page` rules, body widths, layout family, labels (single source of truth; the CSS is generated from it). |
| `docType.ts` | The six `DocType`s + `DOC_META` (title, taxDoc/isNote flags); `deriveDocType(hasBuyerGstin)`. |
| `template.ts` | The **localStorage** per-shop `PrintTemplate` (SALT-095) + `loadTemplate`/`saveTemplate`, keyed by shop id. |
| `invoiceConfig.ts` | The **DB** default loader (SALT-165): `loadInvoiceConfig()` reads `print_templates`, caches once/session; `invalidateInvoiceConfig()` drops the cache. |
| `i18n.ts` | Bilingual label dictionary + `pick()` (SALT-098). |
| `prefs.ts` | Remembered default format + language (localStorage). |
| `words.ts` | `rupeesInWords` — integer-paise → Indian-numbering words (rule-46 amount in words). |
| `taxSummary.ts` | `taxSummary` — groups lines by GST rate, backs out taxable + CGST/SGST or IGST per slab. |

## Data model

The print module **owns no tables**; it reads two stores for customisation, layered:

1. **`print_templates`** (DB, migration `supabase/migrations/0024_settings.sql`) — the **org default**, authored in Settings → Print templates (SALT-089). Columns: `org_id`, `shop_id`, `doc_type`, `format` (`thermal`/`a4`/`dotmatrix`), `template jsonb`, `is_default`. RLS scopes reads to the caller's org, so the print loader needs no org id. The jsonb shape is the **shared contract** in `apps/web/src/lib/printTemplate.ts` (`InvoiceTemplate`: `thermal_width`/`header_tagline`/`show_gstin`/`show_batch_expiry`/`footer_text`/`terms_text`/`copies`) — the print side reuses its `normalizeTemplate`/`normalizeFormat`, never redefining it.
2. **localStorage `PrintTemplate`** (SALT-095) — a **device-level override** (logo / licenses / signature) edited live in the print popup. It layers on top of the DB default and wins per-field when set.

No RPCs — printing is a pure read + client render. The invoice data itself comes from the [`sales_invoices`/`sale_lines`](data-model.md) write-path via `buildInvoiceData`.

## Decisions & gotchas

- **Render-only, server-trusted totals.** The renderer never recomputes money; it formats `InvoicePrintData` as built by the server-side RPC. Keeps the printed figure identical to the persisted bill.
- **Sync window open, async fill (SALT-165).** `printInvoice` is called un-awaited from billing's `useCheckout` (a file outside the print lane). To honour the async DB template without losing the user-gesture (which would get the popup blocked), the window opens **synchronously** with a placeholder, then fills once `loadInvoiceConfig()` resolves. Subsequent prints use the session cache synchronously.
- **Two template systems, reconciled.** SALT-095 (localStorage) and SALT-089/165 (DB) are intentionally distinct: DB = org default authored in Settings; localStorage = per-device popup tweaks. They were disconnected until SALT-165 wired the DB read; localStorage overrides layer on top.
- **Dot-matrix stays English & glyph-free.** The monospace layout uses a fixed 61-column grid and avoids the `₹` glyph (impact-printer fonts can't render it) and Devanagari (not monospaced) — so columns always align.
- **`</script>` / HTML escaping.** Template fields are user text injected into both visible HTML and a `window.__TPL` script tag; `<` is escaped in the JSON injection and all visible fields are HTML-escaped so a stray `</script>` can't break out.
- **HSN threading is billing-owned.** The A4 rule-46 layout renders an HSN column; the data (`item.hsn` → `BillLine` → `InvoiceLine`) is threaded by the billing lane (filed as a cross-module ticket), since `store/bill.ts` is theirs.

## Current state vs planned

**Shipped & on `main`:** all six print tickets above. The full counter Save & Print path renders compliant invoices in four formats, in two languages, in six document variants, honouring both the org's settings template and per-device tweaks.

**Not yet built (out of scope of these tickets):**
- **Reprint / share from Bills history** — reprint a past invoice or share it as PDF / WhatsApp. Needs to reconstruct `InvoicePrintData` from persisted `sales_invoices`/`sale_lines` (live bill state is gone by then), reusing this render pipeline.
- **Server-rendered PDF** — today printing is browser-driven (the `@page` + `window.print()` path). A true PDF artifact (for WhatsApp/email/archival) would need a render service.
- **GRN / purchase document printing** — this module is sales-side; the inbound [GRN](grn.md) has no print path yet.

## Related
[billing-screen](billing-screen.md) · [billing](billing.md) · [gst-returns](gst-returns.md) · [domain/orders](../domain/orders.md) · [product/product-modules](../product/product-modules.md) · raw source: `salt-prd-v0.3.md` (Counter/print as a D&C Rules requirement), migration `supabase/migrations/0024_settings.sql`.
