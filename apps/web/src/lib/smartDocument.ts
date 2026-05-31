// Header+line document import (registers: purchases, and later sales/returns).
// Pure logic — group a flat one-row-per-line register into {header, lines[]} and
// build DB-ready payloads. History loads via DIRECT NON-POSTING inserts (no stock
// movement, no double entry): the row carries source_doc_no (idempotency, ADR
// 0011) and posts_effects=false (cutover, ADR 0012). See
// wiki/architecture/smart-import-extension.md.

import { toPaise, type FieldDef } from "@/lib/smartImport";

export interface DocumentConfig {
  key: string; // step key, e.g. "purchases"
  label: string; // "Purchases / GRN"
  section: string; // "History"
  kind: "purchase" | "sales" | "credit_note" | "debit_note"; // selects the payload builder + party requirement
  table: string; // header table, e.g. "purchases"
  lineTable: string; // "purchase_lines"
  lineFk: string; // FK column on the line table → header, e.g. "purchase_id"
  description: string;
  tip: string;
  headerFields: FieldDef[]; // must include a "doc_no" field (the grouping/dedup key)
  lineFields: FieldDef[]; // must include an "item_name" field
}

export const PURCHASE_DOC: DocumentConfig = {
  key: "purchases",
  label: "Purchases / GRN",
  section: "History",
  kind: "purchase",
  table: "purchases",
  lineTable: "purchase_lines",
  lineFk: "purchase_id",
  description: "Your purchase / GRN register — one row per line, grouped into bills.",
  tip: "Export the purchase register with item + batch detail. Imported as records (no stock re-posting); vendors must already exist (import ledgers first).",
  headerFields: [
    { key: "doc_no", label: "Bill / GRN no", required: true, aliases: ["bill no", "invoice no", "grn no", "purchase no", "voucher no", "vendor invoice", "ref no", "bill"] },
    { key: "date", label: "Date", aliases: ["date", "bill date", "invoice date", "grn date", "purchase date"] },
    { key: "vendor_name", label: "Vendor", aliases: ["vendor", "supplier", "party", "party name", "account", "seller"] },
    { key: "vendor_gstin", label: "Vendor GSTIN", aliases: ["gstin", "gst no", "gst number", "vendor gstin", "party gstin"] },
  ],
  lineFields: [
    { key: "item_code", label: "Item code", aliases: ["item code", "code", "sku", "product code", "itemcode"] },
    { key: "item_name", label: "Item", required: true, aliases: ["item", "product", "item name", "product name", "description", "particulars", "medicine"] },
    { key: "batch_no", label: "Batch", aliases: ["batch", "batch no", "lot", "lot no"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "exp date", "expiry date", "expdate"] },
    { key: "qty", label: "Qty", aliases: ["qty", "quantity", "pcs", "received"] },
    { key: "free_qty", label: "Free", aliases: ["free", "free qty", "scheme qty", "fqty"] },
    { key: "ptr", label: "PTR / Cost", aliases: ["ptr", "purchase rate", "cost", "cost price", "p rate", "purchase price", "rate"] },
    { key: "mrp", label: "MRP", aliases: ["mrp", "m.r.p", "max retail price"] },
    { key: "gst_rate", label: "GST %", aliases: ["gst", "gst%", "gst rate", "igst", "tax", "tax%"] },
    { key: "scheme_text", label: "Scheme", aliases: ["scheme", "offer"] },
    { key: "amount", label: "Amount", aliases: ["amount", "value", "net amount", "line total", "taxable", "net"] },
  ],
};

export const SALES_DOC: DocumentConfig = {
  key: "sales",
  label: "Sales register",
  section: "History",
  kind: "sales",
  table: "sales_invoices",
  lineTable: "sale_lines",
  lineFk: "invoice_id",
  description: "Your sales register — one row per line, grouped into invoices.",
  tip: "Export the sale register with item + batch detail. Imported as records (no stock/ledger re-posting); unknown customers import as walk-in.",
  headerFields: [
    { key: "doc_no", label: "Invoice no", required: true, aliases: ["invoice no", "bill no", "voucher no", "sale no", "ref no", "invoice", "bill"] },
    { key: "date", label: "Date", aliases: ["date", "invoice date", "bill date", "sale date"] },
    { key: "party_name", label: "Customer", aliases: ["customer", "party", "party name", "account", "buyer", "patient"] },
    { key: "party_gstin", label: "Customer GSTIN", aliases: ["gstin", "gst no", "gst number", "customer gstin", "party gstin"] },
    { key: "doctor_name", label: "Doctor", aliases: ["doctor", "dr", "prescriber", "doctor name"] },
  ],
  lineFields: [
    { key: "item_code", label: "Item code", aliases: ["item code", "code", "sku", "product code", "itemcode"] },
    { key: "item_name", label: "Item", required: true, aliases: ["item", "product", "item name", "product name", "description", "particulars", "medicine"] },
    { key: "batch_no", label: "Batch", aliases: ["batch", "batch no", "lot", "lot no"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "exp date", "expiry date", "expdate"] },
    { key: "qty", label: "Qty", aliases: ["qty", "quantity", "pcs", "sold"] },
    { key: "rate", label: "Rate / MRP", aliases: ["rate", "mrp", "sale rate", "price", "m.r.p"] },
    { key: "gst_rate", label: "GST %", aliases: ["gst", "gst%", "gst rate", "igst", "tax", "tax%"] },
    { key: "amount", label: "Amount", aliases: ["amount", "value", "net amount", "line total", "total", "net"] },
  ],
};

export const CREDIT_NOTE_DOC: DocumentConfig = {
  key: "credit_notes",
  label: "Sales returns",
  section: "History",
  kind: "credit_note",
  table: "credit_notes",
  lineTable: "credit_note_lines",
  lineFk: "credit_note_id",
  description: "Your sales-return register (credit notes) — one row per line, grouped by note no.",
  tip: "Export the sales-return register with item detail. Imported as records (no stock/ledger re-posting); unknown customers import as walk-in.",
  headerFields: [
    { key: "doc_no", label: "Note no", required: true, aliases: ["note no", "credit note no", "cn no", "return no", "voucher no", "ref no", "note", "bill no"] },
    { key: "date", label: "Date", aliases: ["date", "note date", "return date", "bill date"] },
    { key: "party_name", label: "Customer", aliases: ["customer", "party", "party name", "account", "buyer"] },
    { key: "party_gstin", label: "Customer GSTIN", aliases: ["gstin", "gst no", "gst number", "customer gstin", "party gstin"] },
    { key: "reason", label: "Reason", aliases: ["reason", "remark", "remarks", "narration"] },
  ],
  lineFields: [
    { key: "item_code", label: "Item code", aliases: ["item code", "code", "sku", "product code", "itemcode"] },
    { key: "item_name", label: "Item", required: true, aliases: ["item", "product", "item name", "product name", "description", "particulars", "medicine"] },
    { key: "batch_no", label: "Batch", aliases: ["batch", "batch no", "lot", "lot no"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "exp date", "expiry date", "expdate"] },
    { key: "qty", label: "Qty", aliases: ["qty", "quantity", "pcs", "returned"] },
    { key: "rate", label: "Rate / MRP", aliases: ["rate", "mrp", "sale rate", "price", "m.r.p"] },
    { key: "gst_rate", label: "GST %", aliases: ["gst", "gst%", "gst rate", "igst", "tax", "tax%"] },
    { key: "amount", label: "Amount", aliases: ["amount", "value", "net amount", "line total", "total", "net"] },
  ],
};

export const DEBIT_NOTE_DOC: DocumentConfig = {
  key: "debit_notes",
  label: "Purchase returns",
  section: "History",
  kind: "debit_note",
  table: "debit_notes",
  lineTable: "debit_note_lines",
  lineFk: "debit_note_id",
  description: "Your purchase-return register (debit notes) — one row per line, grouped by note no.",
  tip: "Export the purchase-return register with item detail. Imported as records (no stock re-posting); vendors must already exist (import ledgers first).",
  headerFields: [
    { key: "doc_no", label: "Note no", required: true, aliases: ["note no", "debit note no", "dn no", "return no", "voucher no", "ref no", "note", "bill no"] },
    { key: "date", label: "Date", aliases: ["date", "note date", "return date", "bill date"] },
    { key: "vendor_name", label: "Vendor", aliases: ["vendor", "supplier", "party", "party name", "account", "seller"] },
    { key: "vendor_gstin", label: "Vendor GSTIN", aliases: ["gstin", "gst no", "gst number", "vendor gstin", "party gstin"] },
    { key: "reason", label: "Reason", aliases: ["reason", "remark", "remarks", "narration"] },
  ],
  lineFields: [
    { key: "item_code", label: "Item code", aliases: ["item code", "code", "sku", "product code", "itemcode"] },
    { key: "item_name", label: "Item", required: true, aliases: ["item", "product", "item name", "product name", "description", "particulars", "medicine"] },
    { key: "batch_no", label: "Batch", aliases: ["batch", "batch no", "lot", "lot no"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "exp date", "expiry date", "expdate"] },
    { key: "qty", label: "Qty", aliases: ["qty", "quantity", "pcs", "returned"] },
    { key: "ptr", label: "PTR / Cost", aliases: ["ptr", "purchase rate", "cost", "cost price", "p rate", "purchase price", "rate"] },
    { key: "gst_rate", label: "GST %", aliases: ["gst", "gst%", "gst rate", "igst", "tax", "tax%"] },
    { key: "amount", label: "Amount", aliases: ["amount", "value", "net amount", "line total", "taxable", "net"] },
  ],
};

export const DOCUMENTS: DocumentConfig[] = [PURCHASE_DOC, SALES_DOC, CREDIT_NOTE_DOC, DEBIT_NOTE_DOC];

export interface DocGroup {
  docNo: string;
  header: Record<string, string>;
  lines: Record<string, string>[];
}

export interface DocCtx {
  // Parties (ledgers) — used for the vendor on a purchase and the customer on a sale.
  partyByGstin: Map<string, string>;
  partyByName: Map<string, string>;
  itemByCode: Map<string, string>;
  itemByName: Map<string, string>;
}

export interface PreparedDoc {
  docNo: string;
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

export interface PrepareResult {
  valid: PreparedDoc[];
  quarantined: { docNo: string; reason: string; lineCount: number }[];
  skippedLines: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
const toInt = (s: string) => {
  const n = Number((s || "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const toNum = (s: string) => {
  const n = Number((s || "").replace(/[, %]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/** dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd → ISO yyyy-mm-dd, or null. */
export function toIsoDate(s: string): string | null {
  const t = (s || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Group a flat register (one row per line) into documents by doc-no. Header
 * fields are the first non-empty value seen across the group; a row with a blank
 * doc-no is treated as a continuation of the previous document.
 */
export function groupDocuments(
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  cfg: DocumentConfig,
): DocGroup[] {
  const get = (row: Record<string, string>, key: string) => {
    const h = mapping[key];
    return h ? (row[h] ?? "").trim() : "";
  };
  const headerKeys = cfg.headerFields.map((f) => f.key);
  const lineKeys = cfg.lineFields.map((f) => f.key);
  const groups: DocGroup[] = [];
  const byNo = new Map<string, DocGroup>();
  let lastNo = "";
  for (const row of rows) {
    let docNo = get(row, "doc_no");
    if (!docNo) docNo = lastNo; // continuation line
    if (!docNo) continue; // no doc-no at all
    lastNo = docNo;
    let g = byNo.get(docNo);
    if (!g) {
      g = { docNo, header: {}, lines: [] };
      byNo.set(docNo, g);
      groups.push(g);
    }
    for (const k of headerKeys) {
      if (!g.header[k]) {
        const v = get(row, k);
        if (v) g.header[k] = v;
      }
    }
    const line: Record<string, string> = {};
    let hasContent = false;
    for (const k of lineKeys) {
      const v = get(row, k);
      line[k] = v;
      if (v) hasContent = true;
    }
    if (hasContent) g.lines.push(line);
  }
  return groups;
}

/**
 * Build DB-ready purchase payloads from grouped documents. Resolves the vendor
 * (GSTIN → name) — a document with no resolvable vendor is quarantined, since
 * purchases.vendor_id is NOT NULL. Lines resolve their item by code → name
 * (item_id may stay null; the line keeps its name). Amounts are rupees → paise;
 * GST is taken as given (history is not recomputed).
 */
export function preparePurchases(groups: DocGroup[], ctx: DocCtx): PrepareResult {
  const valid: PreparedDoc[] = [];
  const quarantined: PrepareResult["quarantined"] = [];
  let skippedLines = 0;

  for (const g of groups) {
    const gstin = (g.header.vendor_gstin ?? "").toUpperCase();
    let vendorId = gstin && GSTIN_RE.test(gstin) ? ctx.partyByGstin.get(gstin) : undefined;
    if (!vendorId && g.header.vendor_name) vendorId = ctx.partyByName.get(norm(g.header.vendor_name));
    if (!vendorId) {
      quarantined.push({
        docNo: g.docNo,
        reason: g.header.vendor_name ? `Vendor not found: ${g.header.vendor_name}` : "No vendor on document",
        lineCount: g.lines.length,
      });
      continue;
    }

    const lines: Record<string, unknown>[] = [];
    let taxable = 0;
    for (const ln of g.lines) {
      const code = (ln.item_code ?? "").trim();
      const nm = (ln.item_name ?? "").trim();
      let itemId = code ? ctx.itemByCode.get(code) : undefined;
      if (!itemId && nm) itemId = ctx.itemByName.get(norm(nm));
      if (!nm && !itemId) {
        skippedLines++;
        continue;
      }
      const qty = toInt(ln.qty);
      const ptr = toPaise(ln.ptr);
      const amount = ln.amount ? toPaise(ln.amount) : qty * ptr;
      taxable += amount;
      lines.push({
        item_id: itemId ?? null,
        name: nm || "(unnamed)",
        batch_no: ln.batch_no || null,
        expiry: ln.expiry || null,
        qty,
        free_qty: toInt(ln.free_qty),
        ptr_paise: ptr,
        mrp_paise: toPaise(ln.mrp),
        scheme_text: ln.scheme_text || null,
        taxable_paise: amount,
        gst_rate: toNum(ln.gst_rate),
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        line_total_paise: amount,
      });
    }
    if (lines.length === 0) {
      quarantined.push({ docNo: g.docNo, reason: "No usable lines", lineCount: 0 });
      continue;
    }

    const date = toIsoDate(g.header.date ?? "");
    const header: Record<string, unknown> = {
      vendor_id: vendorId,
      vendor_invoice_no: g.docNo,
      vendor_invoice_date: date,
      is_interstate: false,
      subtotal_paise: taxable,
      taxable_paise: taxable,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      total_paise: taxable,
      paid_paise: 0,
      status: "received",
      source_system: "marg",
      source_doc_no: g.docNo,
      posts_effects: false,
      // received_date omitted when unknown so the column default (current_date) applies
      ...(date ? { received_date: date } : {}),
    };
    valid.push({ docNo: g.docNo, header, lines });
  }

  return { valid, quarantined, skippedLines };
}

/** Resolve a party (ledger) id by GSTIN → name; undefined if neither matches. */
function resolveParty(gstinRaw: string | undefined, name: string | undefined, ctx: DocCtx): string | undefined {
  const gstin = (gstinRaw ?? "").toUpperCase();
  let id = gstin && GSTIN_RE.test(gstin) ? ctx.partyByGstin.get(gstin) : undefined;
  if (!id && name) id = ctx.partyByName.get(norm(name));
  return id;
}

/**
 * Build DB-ready sales-invoice payloads from grouped documents. Sales are
 * MRP-inclusive, so per-line GST is backed out of the line total (taxable + tax)
 * and split CGST/SGST (intra-state assumption — display only, since imported
 * history is non-posting). The customer is resolved GSTIN → name, but an unknown
 * customer is NOT quarantined: sales_invoices.party_id is nullable, so it imports
 * as walk-in (party_id null) with the original name kept in notes. A document
 * with no usable lines is quarantined.
 */
export function prepareSales(groups: DocGroup[], ctx: DocCtx): PrepareResult {
  const valid: PreparedDoc[] = [];
  const quarantined: PrepareResult["quarantined"] = [];
  let skippedLines = 0;

  for (const g of groups) {
    const partyId = resolveParty(g.header.party_gstin, g.header.party_name, ctx);
    // Unmatched named customer → keep the name so the record isn't anonymous.
    const unmatchedName = !partyId && g.header.party_name ? g.header.party_name.trim() : "";

    const lines: Record<string, unknown>[] = [];
    let subtotal = 0; // tax-inclusive gross
    let taxableTot = 0;
    let cgstTot = 0;
    let sgstTot = 0;
    for (const ln of g.lines) {
      const code = (ln.item_code ?? "").trim();
      const nm = (ln.item_name ?? "").trim();
      let itemId = code ? ctx.itemByCode.get(code) : undefined;
      if (!itemId && nm) itemId = ctx.itemByName.get(norm(nm));
      if (!nm && !itemId) {
        skippedLines++;
        continue;
      }
      const qty = toInt(ln.qty);
      const rate = toNum(ln.gst_rate);
      const gross = ln.amount ? toPaise(ln.amount) : qty * toPaise(ln.rate);
      // back MRP-inclusive tax out of the gross line total
      const taxable = rate > 0 ? Math.round((gross * 100) / (100 + rate)) : gross;
      const tax = gross - taxable;
      const cgst = Math.floor(tax / 2);
      const sgst = tax - cgst;
      subtotal += gross;
      taxableTot += taxable;
      cgstTot += cgst;
      sgstTot += sgst;
      lines.push({
        item_id: itemId ?? null,
        name: nm || "(unnamed)",
        batch_no: ln.batch_no || null,
        expiry: ln.expiry || null,
        qty,
        rate_paise: toPaise(ln.rate),
        taxable_paise: taxable,
        gst_rate: rate,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: 0,
        line_total_paise: gross,
      });
    }
    if (lines.length === 0) {
      quarantined.push({ docNo: g.docNo, reason: "No usable lines", lineCount: 0 });
      continue;
    }

    const date = toIsoDate(g.header.date ?? "");
    const header: Record<string, unknown> = {
      party_id: partyId ?? null,
      invoice_no: g.docNo,
      status: "placed",
      is_interstate: false,
      subtotal_paise: subtotal,
      taxable_paise: taxableTot,
      cgst_paise: cgstTot,
      sgst_paise: sgstTot,
      igst_paise: 0,
      total_paise: subtotal,
      paid_paise: 0,
      doctor_name: g.header.doctor_name || null,
      notes: unmatchedName ? `Customer: ${unmatchedName}` : null,
      source_system: "marg",
      source_doc_no: g.docNo,
      posts_effects: false,
      ...(date ? { invoice_date: date } : {}),
    };
    valid.push({ docNo: g.docNo, header, lines });
  }

  return { valid, quarantined, skippedLines };
}

/**
 * Build DB-ready credit-note (sales-return) payloads. Like sales: MRP-inclusive
 * `rate`, tax backed out of the line gross, CGST/SGST split (display only — non
 * posting). credit_notes.party_id is nullable, so an unmatched customer imports
 * as walk-in (party_id null) with the name kept in notes. A note with no usable
 * lines is quarantined.
 */
export function prepareCreditNote(groups: DocGroup[], ctx: DocCtx): PrepareResult {
  const valid: PreparedDoc[] = [];
  const quarantined: PrepareResult["quarantined"] = [];
  let skippedLines = 0;

  for (const g of groups) {
    const partyId = resolveParty(g.header.party_gstin, g.header.party_name, ctx);
    const unmatchedName = !partyId && g.header.party_name ? g.header.party_name.trim() : "";

    const lines: Record<string, unknown>[] = [];
    let taxableTot = 0;
    let cgstTot = 0;
    let sgstTot = 0;
    let total = 0;
    for (const ln of g.lines) {
      const code = (ln.item_code ?? "").trim();
      const nm = (ln.item_name ?? "").trim();
      let itemId = code ? ctx.itemByCode.get(code) : undefined;
      if (!itemId && nm) itemId = ctx.itemByName.get(norm(nm));
      if (!nm && !itemId) {
        skippedLines++;
        continue;
      }
      const qty = toInt(ln.qty);
      const rate = toNum(ln.gst_rate);
      const gross = ln.amount ? toPaise(ln.amount) : qty * toPaise(ln.rate);
      const taxable = rate > 0 ? Math.round((gross * 100) / (100 + rate)) : gross;
      const tax = gross - taxable;
      const cgst = Math.floor(tax / 2);
      const sgst = tax - cgst;
      taxableTot += taxable;
      cgstTot += cgst;
      sgstTot += sgst;
      total += gross;
      lines.push({
        item_id: itemId ?? null,
        name: nm || "(unnamed)",
        batch_no: ln.batch_no || null,
        expiry: ln.expiry || null,
        qty,
        rate_paise: toPaise(ln.rate),
        taxable_paise: taxable,
        gst_rate: rate,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: 0,
        line_total_paise: gross,
      });
    }
    if (lines.length === 0) {
      quarantined.push({ docNo: g.docNo, reason: "No usable lines", lineCount: 0 });
      continue;
    }

    const date = toIsoDate(g.header.date ?? "");
    const header: Record<string, unknown> = {
      party_id: partyId ?? null,
      note_no: g.docNo,
      reason: g.header.reason || null,
      is_interstate: false,
      taxable_paise: taxableTot,
      cgst_paise: cgstTot,
      sgst_paise: sgstTot,
      igst_paise: 0,
      total_paise: total,
      status: "placed",
      notes: unmatchedName ? `Customer: ${unmatchedName}` : null,
      source_system: "marg",
      source_doc_no: g.docNo,
      posts_effects: false,
      ...(date ? { note_date: date } : {}),
    };
    valid.push({ docNo: g.docNo, header, lines });
  }

  return { valid, quarantined, skippedLines };
}

/**
 * Build DB-ready debit-note (purchase-return) payloads. Like purchases: `ptr` is
 * tax-exclusive, GST added on top; debit_notes.vendor_id is NOT NULL, so a note
 * with no resolvable vendor is quarantined. itc_reversal_paise = the GST reversed.
 */
export function prepareDebitNote(groups: DocGroup[], ctx: DocCtx): PrepareResult {
  const valid: PreparedDoc[] = [];
  const quarantined: PrepareResult["quarantined"] = [];
  let skippedLines = 0;

  for (const g of groups) {
    const vendorId = resolveParty(g.header.vendor_gstin, g.header.vendor_name, ctx);
    if (!vendorId) {
      quarantined.push({
        docNo: g.docNo,
        reason: g.header.vendor_name ? `Vendor not found: ${g.header.vendor_name}` : "No vendor on document",
        lineCount: g.lines.length,
      });
      continue;
    }

    const lines: Record<string, unknown>[] = [];
    let taxableTot = 0;
    let cgstTot = 0;
    let sgstTot = 0;
    let total = 0;
    for (const ln of g.lines) {
      const code = (ln.item_code ?? "").trim();
      const nm = (ln.item_name ?? "").trim();
      let itemId = code ? ctx.itemByCode.get(code) : undefined;
      if (!itemId && nm) itemId = ctx.itemByName.get(norm(nm));
      if (!nm && !itemId) {
        skippedLines++;
        continue;
      }
      const qty = toInt(ln.qty);
      const ptr = toPaise(ln.ptr);
      const rate = toNum(ln.gst_rate);
      // taxable is tax-exclusive: use the amount column if given, else qty × ptr
      const taxable = ln.amount ? toPaise(ln.amount) : qty * ptr;
      const tax = Math.round((taxable * rate) / 100);
      const cgst = Math.floor(tax / 2);
      const sgst = tax - cgst;
      taxableTot += taxable;
      cgstTot += cgst;
      sgstTot += sgst;
      total += taxable + tax;
      lines.push({
        item_id: itemId ?? null,
        name: nm || "(unnamed)",
        batch_no: ln.batch_no || null,
        expiry: ln.expiry || null,
        qty,
        ptr_paise: ptr,
        taxable_paise: taxable,
        gst_rate: rate,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: 0,
        line_total_paise: taxable + tax,
      });
    }
    if (lines.length === 0) {
      quarantined.push({ docNo: g.docNo, reason: "No usable lines", lineCount: 0 });
      continue;
    }

    const date = toIsoDate(g.header.date ?? "");
    const header: Record<string, unknown> = {
      vendor_id: vendorId,
      note_no: g.docNo,
      reason: g.header.reason || null,
      is_interstate: false,
      taxable_paise: taxableTot,
      cgst_paise: cgstTot,
      sgst_paise: sgstTot,
      igst_paise: 0,
      itc_reversal_paise: cgstTot + sgstTot,
      total_paise: total,
      status: "placed",
      source_system: "marg",
      source_doc_no: g.docNo,
      posts_effects: false,
      ...(date ? { note_date: date } : {}),
    };
    valid.push({ docNo: g.docNo, header, lines });
  }

  return { valid, quarantined, skippedLines };
}

/** Dispatch to the right payload builder for a document config. */
export function prepareDocuments(cfg: DocumentConfig, groups: DocGroup[], ctx: DocCtx): PrepareResult {
  switch (cfg.kind) {
    case "sales":
      return prepareSales(groups, ctx);
    case "credit_note":
      return prepareCreditNote(groups, ctx);
    case "debit_note":
      return prepareDebitNote(groups, ctx);
    default:
      return preparePurchases(groups, ctx);
  }
}
