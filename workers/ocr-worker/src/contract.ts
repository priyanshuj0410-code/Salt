// OUTPUT-PARITY CONTRACT — mirror of supabase/functions/extract-invoice/index.ts.
//
// The Gemma worker MUST emit the SAME JSON shape as the Gemini Flash extractor, so
// the downstream Salt path (ocrInvoice.ts -> parsePurchaseInvoices -> review ->
// receive_purchase) handles both lanes identically. PROMPT and parseModelJson are
// copied VERBATIM from extract-invoice. If you change one, change BOTH — they are
// the single source of truth for the invoice JSON contract.
//
// (Expiry is intentionally NOT normalised here: the Flash lane stores the raw
// extraction too, and apps/web/src/lib/ocrInvoice.ts#normalizeExpiry does MM/YYYY
// -> YYYY-MM at the OCR->rows boundary for BOTH lanes. Doing it here would diverge.)

/** The columns the CSV importer understands (PURCHASE_IMPORT_COLUMNS). The model
 *  is told to use exactly these keys per line so the client maps 1:1. */
export const PROMPT = `You are extracting an Indian pharmaceutical distributor's purchase invoice.
Return ONLY valid JSON (no prose, no markdown fence) of this exact shape:
{
  "invoice_no": string,
  "date": string,            // as printed, prefer DD-MM-YYYY or YYYY-MM-DD
  "vendor": string,          // distributor/seller name
  "vendor_gstin": string,    // 15-char GSTIN if present, else ""
  "lines": [
    {
      "item_name": string,
      "item_code": string,   // vendor product code if any, else ""
      "hsn": string,
      "batch_no": string,
      "expiry": string,      // MM/YYYY or YYYY-MM if present, else ""
      "qty": number,
      "free_qty": number,    // scheme free units, else 0
      "ptr": number,         // price to retailer per unit (rupees, tax-exclusive), else 0
      "pts": number,         // price to stockist per unit (rupees, tax-exclusive), else 0 — fill BOTH if the bill prints both
      "amount": number,      // the line net/taxable VALUE as printed (after scheme/discount, before GST), else 0
      "mrp": number,         // printed MRP per unit (rupees), else 0
      "gst_rate": number,    // % (0/5/12/18), use the line's IGST or CGST+SGST sum
      "discount_pct": number // trade discount %, else 0
    }
  ]
}
Rules: numbers are plain (no currency symbols/commas). If a field is absent use ""
for strings and 0 for numbers. Do NOT invent lines; transcribe only what is printed.
When the bill prints both PTR and PTS, capture BOTH, plus the line value/amount column
as "amount" — the rate the line total was computed from is reconciled downstream.
Money is per-unit in rupees, not paise.`;

/** Pull the FIRST complete JSON object out of the model's reply, tolerating stray
 *  fencing AND trailing content. Brace-match from the first { (respecting strings +
 *  escapes) and parse exactly the first balanced object — everything after it is
 *  discarded. */
export function parseModelJson(raw: string): unknown {
  const fence = raw.replace(/```json\s*|\s*```/g, "");
  const start = fence.indexOf("{");
  if (start === -1) throw new Error("model did not return JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < fence.length; i++) {
    const ch = fence[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(fence.slice(start, i + 1));
    }
  }
  throw new Error("model returned incomplete JSON"); // never closed → truncated output
}

/** Merge per-page extractions of ONE invoice into a single OcrInvoiceJson: header from
 *  the first page that has an invoice no / vendor; line items concatenated in order.
 *  Used by the vision path for multi-page PDFs (PRD §14.7). */
export function mergeInvoiceJson(parts: unknown[]): unknown {
  const objs = parts.filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && !Array.isArray(p));
  const str = (o: Record<string, unknown>, k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  if (objs.length === 0) return { invoice_no: "", date: "", vendor: "", vendor_gstin: "", lines: [] };
  const header = objs.find((o) => str(o, "invoice_no") || str(o, "vendor")) ?? objs[0];
  const lines = objs.flatMap((o) => (Array.isArray(o.lines) ? o.lines : []));
  return {
    invoice_no: str(header, "invoice_no"),
    date: str(header, "date"),
    vendor: str(header, "vendor"),
    vendor_gstin: str(header, "vendor_gstin"),
    lines,
  };
}
