export type EntityKey =
  | "ledgers"
  | "party_gstin"
  | "items"
  | "batches"
  | "salesmen"
  | "doctors"
  | "shops"
  | "h1_register"
  | "drug_licenses"
  | "gst_returns"
  | "invoice_series";

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export interface EntityConfig {
  key: EntityKey;
  label: string;
  /** Cascade order index; downstream entities depend on upstream. */
  order: number;
  /** One-line description of what this step imports. */
  description: string;
  /** A practical tip shown on the upload screen. */
  tip: string;
  fields: FieldDef[];
  /** Inject the active shop_id into each row (shop-scoped tables like the
   *  compliance registers). Default false = org-scoped only. */
  shopScoped?: boolean;
  /** Upsert (not insert) on this conflict target, e.g. "org_id,shop_id,doc_type,financial_year"
   *  — for idempotent re-import of keyed records (invoice series, filed returns). */
  upsertOn?: string;
}

export const ENTITIES: EntityConfig[] = [
  {
    key: "ledgers",
    label: "Ledgers",
    order: 0,
    description: "Your parties: customers and suppliers/distributors. Import these first.",
    tip: "GSTIN is checked but never blocks the import; Type defaults to customer when blank.",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["party", "ledger", "account", "customer", "supplier", "vendor", "party name", "particulars"] },
      { key: "type", label: "Type", aliases: ["category", "group", "account group"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "contact", "phone no", "mobile no"] },
      { key: "gstin", label: "GSTIN", aliases: ["gst", "gst no", "gst number", "tax id"] },
      { key: "address", label: "Address", aliases: ["city", "location"] },
      { key: "credit_limit", label: "Credit limit", aliases: ["credit", "limit", "cr limit"] },
    ],
  },
  {
    key: "party_gstin",
    label: "Party details",
    order: 1,
    description: "Enrich your imported parties with GSTIN, address and phone from your GST master.",
    tip: 'Export "Party GST Master" from Marg/Saral. We match by name and fill missing details. Existing values are never overwritten.',
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["party", "ledger", "account", "customer", "supplier", "particulars", "party name"] },
      { key: "gstin", label: "GSTIN", aliases: ["gst", "gst no", "gst number", "tax id", "gstin no"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "contact", "phone no", "mobile no", "telephone"] },
      { key: "address", label: "Address", aliases: ["city", "location", "add", "addr"] },
    ],
  },
  {
    key: "items",
    label: "Items",
    order: 2,
    description: "Your product master: medicines and surgicals with salt, tax and schedule.",
    tip: "Missing HSN is allowed (flagged as a warning); an unknown Schedule defaults to OTC.",
    fields: [
      { key: "item_code", label: "Code", aliases: ["code", "item code", "itemcode", "product code", "sku"] },
      { key: "name", label: "Name", required: true, aliases: ["item", "product", "medicine", "item name", "product name", "description"] },
      { key: "salt", label: "Salt", aliases: ["molecule", "composition", "generic", "content"] },
      { key: "manufacturer", label: "Manufacturer", aliases: ["company", "mfr", "maker", "brand", "comp"] },
      { key: "pack", label: "Pack", aliases: ["packing", "pack size", "unit"] },
      { key: "hsn", label: "HSN", aliases: ["hsn code", "hsncode"] },
      { key: "gst_rate", label: "GST %", aliases: ["igst", "gst", "tax", "tax slab", "gst rate", "tax %"] },
      { key: "schedule", label: "Schedule", aliases: ["sch", "drug schedule"] },
      { key: "barcode", label: "Barcode", aliases: ["ean", "upc", "bar code"] },
    ],
  },
  {
    key: "batches",
    label: "Batches & stock",
    order: 3,
    description: "Your physical stock: one row per item, linked by code (or name).",
    tip: "Import Items first. We link by item code when present, else by name; unmatched rows are quarantined with a closest-match suggestion.",
    fields: [
      { key: "item_code", label: "Code", aliases: ["code", "item code", "itemcode", "product code", "sku"] },
      { key: "item", label: "Item", required: true, aliases: ["product", "medicine", "item name", "name", "product name"] },
      { key: "batch_no", label: "Batch no", aliases: ["batch", "batch number", "lot", "lot no"] },
      { key: "expiry", label: "Expiry", aliases: ["exp", "exp date", "expiry date", "exp dt", "expdate"] },
      { key: "qty", label: "Quantity", required: true, aliases: ["quantity", "stock", "qty on hand", "closing stock", "balance"] },
      { key: "mrp", label: "MRP", required: true, aliases: ["rate", "price", "sale rate", "mrp rate"] },
      { key: "ptr", label: "Purchase price", aliases: ["ptr", "purchase rate", "purchase price", "cost", "buy rate"] },
    ],
  },
  {
    key: "salesmen",
    label: "Salesmen",
    order: 4,
    description: "Your sales staff: so historical sales and collections can be attributed.",
    tip: "Just names; phone and territory are optional. Re-importing adds rows (no dedup).",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["salesman", "sales man", "sales person", "salesperson", "staff", "employee", "representative", "rep", "mr"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "contact", "phone no", "mobile no"] },
      { key: "territory", label: "Territory", aliases: ["area", "region", "route", "beat", "zone"] },
    ],
  },
  {
    key: "doctors",
    label: "Doctors",
    order: 5,
    description: "Prescribing doctors: for Schedule H1/X records and prescriptions.",
    tip: "Name is required; the registration no is the identity key. Re-importing adds rows (no dedup).",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["doctor", "dr", "physician", "prescriber", "doctor name"] },
      { key: "registration_no", label: "Registration no", aliases: ["reg no", "registration", "registration number", "regn no", "mci no", "license no", "imr no"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "contact", "phone no", "mobile no"] },
    ],
  },
  {
    key: "shops",
    label: "Branches",
    order: 6,
    description: "Your branches / outlets: one row per shop. Import each branch's data by switching the active shop.",
    tip: "Name is required; GSTIN/state/code optional. Imported branches are never marked primary.",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["shop", "branch", "outlet", "store", "company", "firm"] },
      { key: "code", label: "Code", aliases: ["short code", "branch code", "shop code", "abbr"] },
      { key: "gstin", label: "GSTIN", aliases: ["gst", "gst no", "gst number", "gstin no"] },
      { key: "state_code", label: "State code", aliases: ["state", "state code", "pos", "place of supply"] },
      { key: "address", label: "Address", aliases: ["city", "location", "add", "addr"] },
      { key: "phone", label: "Phone", aliases: ["mobile", "contact", "phone no", "telephone"] },
    ],
  },
  {
    key: "h1_register",
    label: "Schedule H1/X register",
    order: 7,
    shopScoped: true,
    description: "Your Schedule H1/X sale register. The statutory record (drug, batch, qty, doctor, patient).",
    tip: "Drug name is required; an unknown schedule defaults to H1. Imported under the active shop, as records only (not linked to live invoices).",
    fields: [
      { key: "drug_name", label: "Drug", required: true, aliases: ["drug", "medicine", "item", "product", "drug name", "particulars", "item name"] },
      { key: "schedule", label: "Schedule", aliases: ["schedule", "sch", "drug schedule", "category"] },
      { key: "batch_no", label: "Batch", aliases: ["batch", "batch no", "lot", "lot no"] },
      { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "exp date", "expiry date"] },
      { key: "qty", label: "Qty", aliases: ["qty", "quantity", "units", "pcs", "nos"] },
      { key: "doctor_name", label: "Doctor", aliases: ["doctor", "dr", "prescriber", "doctor name"] },
      { key: "doctor_reg_no", label: "Doctor reg no", aliases: ["doctor reg", "doctor registration", "reg no", "registration", "mci no"] },
      { key: "patient_name", label: "Patient", aliases: ["patient", "patient name", "customer", "buyer"] },
      { key: "patient_address", label: "Patient address", aliases: ["patient address", "address", "add", "addr"] },
      { key: "date", label: "Date", aliases: ["date", "sale date", "sold on", "bill date", "dispensed date", "invoice date"] },
    ],
  },
  {
    key: "drug_licenses",
    label: "Drug licences",
    order: 8,
    shopScoped: true,
    description: "Your drug licences (Form 20 / 21 etc.): type, number, holder, validity dates.",
    tip: "Licence type and number are required; dates accept dd-mm-yyyy or yyyy-mm-dd.",
    fields: [
      { key: "license_type", label: "Type", required: true, aliases: ["type", "license type", "licence type", "form", "form no", "category"] },
      { key: "license_no", label: "Number", required: true, aliases: ["license no", "licence no", "number", "license number", "licence number", "dl no", "reg no"] },
      { key: "holder_name", label: "Holder", aliases: ["holder", "holder name", "name", "proprietor", "licensee", "firm"] },
      { key: "issued_date", label: "Issued", aliases: ["issue date", "issued", "issued date", "valid from", "date of issue"] },
      { key: "expiry_date", label: "Expiry", aliases: ["expiry", "expiry date", "valid upto", "valid till", "valid to", "expires", "renewal date"] },
      { key: "notes", label: "Notes", aliases: ["notes", "remark", "remarks", "description"] },
    ],
  },
  {
    key: "gst_returns",
    label: "Filed GST returns",
    order: 9,
    shopScoped: true,
    upsertOn: "org_id,shop_id,period,return_type",
    description: "Your filed GSTR-1 / GSTR-3B history. An archive of which returns were filed, by period.",
    tip: "Period (YYYY-MM) and return type (GSTR1/GSTR3B) are required; re-import updates the same period+type. Filed figures are kept verbatim in source.",
    fields: [
      { key: "period", label: "Period", required: true, aliases: ["period", "month", "return period", "tax period"] },
      { key: "return_type", label: "Return", required: true, aliases: ["type", "return", "return type", "form", "gst return"] },
      { key: "status", label: "Status", aliases: ["status", "filed", "state"] },
      { key: "filed_date", label: "Filed on", aliases: ["filed date", "filed on", "date of filing", "filed at", "submission date", "arn date"] },
    ],
  },
  {
    key: "invoice_series",
    label: "Invoice series",
    order: 10,
    shopScoped: true,
    upsertOn: "org_id,shop_id,doc_type,financial_year",
    description: "Your voucher numbering: so Salt continues each series without clashing with the old system.",
    tip: "Doc type and financial year are required. Map your NEXT number to use (last used + 1). Re-import updates the same series.",
    fields: [
      { key: "doc_type", label: "Doc type", required: true, aliases: ["doc type", "document type", "type", "voucher type", "series", "book"] },
      { key: "financial_year", label: "Financial year", required: true, aliases: ["financial year", "fy", "year", "f.y.", "fin year"] },
      { key: "prefix", label: "Prefix", aliases: ["prefix", "series prefix", "bill prefix", "pre"] },
      { key: "next_number", label: "Next number", aliases: ["next number", "next no", "last number", "last no", "current number", "running no", "number"] },
    ],
  },
];

export function entityConfig(key: EntityKey): EntityConfig {
  return ENTITIES.find((e) => e.key === key)!;
}

// ---- Auto-map (Levenshtein) ---------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

/**
 * Best match of a header against a field's label/key/aliases, tiered so an
 * exact column-name match strictly beats a mere substring match. This matters
 * for Marg/Saral exports with many lookalike columns (ItemCode vs HSNCode vs
 * HsnName, SGST/CGST/IGST/LocalTax): without tiering, "code" inside "HSNCode"
 * would tie the exact "ItemCode" and the wrong column could win.
 */
function fieldScore(field: FieldDef, header: string): number {
  const h = norm(header);
  if (!h) return 0;
  const candidates = [field.label, field.key, ...field.aliases].map(norm);
  let best = 0;
  for (const c of candidates) {
    if (!c) continue;
    let s: number;
    if (c === h) s = 1; // exact: always wins
    else if (h.includes(c) || c.includes(h))
      s = 0.7 + 0.25 * (Math.min(c.length, h.length) / Math.max(c.length, h.length)); // substring (< 1)
    else s = 0.85 * similarity(c, h); // fuzzy (< substring)
    if (s > best) best = s;
  }
  return best;
}

/**
 * Suggest a mapping of field key -> source header (or null) for a file.
 * Ties resolve to the FIRST (left-most) header so a later lookalike column
 * never displaces an exact earlier match.
 */
export function autoMap(headers: string[], fields: FieldDef[], threshold = 0.72): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const field of fields) {
    let bestHeader: string | null = null;
    let bestScore = threshold;
    for (const header of headers) {
      const s = fieldScore(field, header);
      if (s > bestScore) {
        bestScore = s;
        bestHeader = header;
      }
    }
    map[field.key] = bestHeader;
  }
  return map;
}

// ---- Report-aware table extraction --------------------------------------

export interface Table {
  headers: string[];
  rows: Record<string, string>[];
}

const isNumericCell = (v: string) => {
  const s = v.replace(/[,₹\s]/g, "");
  return s !== "" && Number.isFinite(Number(s));
};

function rowAliasScore(cells: string[], fields: FieldDef[]): number {
  let score = 0;
  for (const cell of cells) {
    if (cell && fields.some((f) => fieldScore(f, cell) >= 0.85)) score++;
  }
  return score;
}

/**
 * Turn a raw sheet matrix into a clean {headers, rows} table, tolerating
 * accounting-report layouts (Marg/Saral/Tally): a title block, a header row,
 * real records (a name + at least one numeric/balance cell), interleaved
 * single-cell transaction/sub-rows, and a footer. Record rows are kept; the
 * rest is dropped. A trailing "Ph.:" sub-row becomes the record's phone, and a
 * Dr/Cr column is mapped to a customer/supplier Type.
 */
export function extractTable(matrix: string[][], fields: FieldDef[]): Table {
  const grid = matrix.map((r) => r.map((c) => (c ?? "").toString().trim()));
  const SUMMARY = /^(grand total|total|sub ?total|opening balance|closing balance)\s*:?\s*$/i;
  const isRecord = (cells: string[]) => {
    const c0 = cells[0] ?? "";
    return c0 !== "" && !SUMMARY.test(c0) && cells.filter(Boolean).length >= 2 && cells.some(isNumericCell);
  };

  const firstRecord = grid.findIndex(isRecord);

  // Plain table (no balance-style records): header is the first non-empty row.
  if (firstRecord === -1) {
    const hIdx = grid.findIndex((r) => r.some(Boolean));
    if (hIdx === -1) return { headers: [], rows: [] };
    const headers = grid[hIdx].map((c, i) => c || `Column ${i + 1}`);
    const rows = grid
      .slice(hIdx + 1)
      .filter((r) => r.some(Boolean))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
    return { headers, rows };
  }

  // Header = best alias-matching row above the first record.
  let headerIdx = -1;
  let best = 0;
  for (let i = 0; i < firstRecord; i++) {
    const s = rowAliasScore(grid[i], fields);
    if (s > best) {
      best = s;
      headerIdx = i;
    }
  }
  const width = Math.max(...grid.slice(firstRecord, firstRecord + 50).map((r) => r.length), 1);
  const headers = (headerIdx >= 0 ? grid[headerIdx] : []).map((c, i) => c || `Column ${i + 1}`);
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);

  const TYPE = "Type (Dr/Cr)";
  const PHONE = "Phone";
  headers.push(TYPE, PHONE);

  const rows: Record<string, string>[] = [];
  let last: Record<string, string> | null = null;
  for (let r = firstRecord; r < grid.length; r++) {
    const cells = grid[r];
    if (isRecord(cells)) {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (i < cells.length) obj[h] = cells[i] ?? "";
      });
      const nature = cells.find((c) => /^(dr|cr)$/i.test(c)) ?? "";
      obj[TYPE] = /cr/i.test(nature) ? "supplier" : nature ? "customer" : "";
      obj[PHONE] = "";
      rows.push(obj);
      last = obj;
    } else {
      const ne = cells.filter(Boolean);
      if (ne.length === 1 && /^ph/i.test(ne[0]) && last) {
        last[PHONE] = ne[0].replace(/^ph\.?:?\s*/i, "");
      }
    }
  }
  return { headers, rows };
}

/** Closest candidate by Levenshtein (for "did you mean" item suggestions). */
export function closest(name: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0.6;
  const n = norm(name);
  for (const c of candidates) {
    const s = similarity(n, norm(c));
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

// ---- Validation + partition ---------------------------------------------

export interface Issue {
  field: string;
  level: "warning" | "error";
  message: string;
}

export interface RowResult {
  index: number;
  /** Mapped raw string values, keyed by field key — editable in the quarantine grid. */
  data: Record<string, string>;
  issues: Issue[];
  /** DB-ready payload (without org_id) when there are no error-level issues. */
  payload: Record<string, unknown> | null;
}

export interface Partition {
  valid: RowResult[];
  quarantined: RowResult[];
}

export interface ValidateCtx {
  /** lowercased item name -> item id, for batch FK resolution. */
  itemByName?: Map<string, string>;
  itemNames?: string[];
  /** item_code -> item id, the precise join when the stock file carries a code. */
  itemByCode?: Map<string, string>;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function toPaise(s: string): number {
  const n = Number((s || "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Coerce many messy date formats to YYYY-MM, or null if unparseable. */
export function toExpiryYM(s: string): string | null {
  const t = (s || "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}/.test(t)) return t.slice(0, 7);
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}`; // YYYYMMDD
  const m = t.match(/^(\d{1,2})[/-](\d{4})$/); // MM/YYYY
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  const d = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); // DD/MM/YYYY
  if (d) {
    const year = d[3].length === 2 ? `20${d[3]}` : d[3];
    return `${year}-${d[2].padStart(2, "0")}`;
  }
  return null;
}

/** Coerce dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd to ISO yyyy-mm-dd, or null. */
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

/** Normalize a free-text voucher/document type to the invoice_series enum. */
function normalizeDocType(s: string): string | null {
  const t = (s || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  if (/(creditnote|salesreturn|salereturn|cn)/.test(t)) return "credit_note";
  if (/(debitnote|purchasereturn|purreturn|dn)/.test(t)) return "debit_note";
  if (/(receipt|payment)/.test(t)) return "payment";
  if (/(sales|sale|invoice|bill|tax)/.test(t)) return "sales_invoice";
  if (/(purchase|grn|inward)/.test(t)) return "purchase";
  return null;
}

function applyMapping(row: Record<string, string>, mapping: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    out[field] = header ? (row[header] ?? "").toString().trim() : "";
  }
  return out;
}

function validate(entity: EntityKey, d: Record<string, string>, ctx: ValidateCtx): { issues: Issue[]; payload: Record<string, unknown> } {
  const issues: Issue[] = [];
  if (entity === "ledgers") {
    if (!d.name) issues.push({ field: "name", level: "error", message: "Missing ledger name" });
    let type = (d.type || "").toLowerCase();
    if (!["customer", "vendor", "other"].includes(type)) type = "customer";
    if (d.gstin && !GSTIN_RE.test(d.gstin.toUpperCase()))
      issues.push({ field: "gstin", level: "warning", message: "GSTIN does not look valid (imported anyway)" });
    return {
      issues,
      payload: {
        name: d.name,
        type,
        phone: d.phone || null,
        gstin: d.gstin ? d.gstin.toUpperCase() : null,
        address: d.address || null,
        credit_limit_paise: toPaise(d.credit_limit),
      },
    };
  }

  if (entity === "items") {
    if (!d.name) issues.push({ field: "name", level: "error", message: "Missing item name" });
    if (!d.hsn) issues.push({ field: "hsn", level: "warning", message: "Missing HSN code" });
    let schedule = (d.schedule || "").toUpperCase();
    if (!["OTC", "H", "H1", "X"].includes(schedule)) {
      if (d.schedule) issues.push({ field: "schedule", level: "warning", message: `Unknown schedule "${d.schedule}", set to OTC` });
      schedule = "OTC";
    }
    return {
      issues,
      payload: {
        item_code: d.item_code || null,
        name: d.name,
        salt: d.salt || null,
        manufacturer: d.manufacturer || null,
        pack: d.pack || null,
        hsn: d.hsn || null,
        gst_rate: Number(d.gst_rate) || 0,
        schedule,
        barcode: d.barcode || null,
      },
    };
  }

  if (entity === "salesmen") {
    if (!d.name) issues.push({ field: "name", level: "error", message: "Missing salesman name" });
    return { issues, payload: { name: d.name, phone: d.phone || null, territory: d.territory || null } };
  }

  if (entity === "doctors") {
    if (!d.name) issues.push({ field: "name", level: "error", message: "Missing doctor name" });
    return { issues, payload: { name: d.name, registration_no: d.registration_no || null, phone: d.phone || null } };
  }

  if (entity === "shops") {
    if (!d.name) issues.push({ field: "name", level: "error", message: "Missing branch name" });
    if (d.gstin && !GSTIN_RE.test(d.gstin.toUpperCase()))
      issues.push({ field: "gstin", level: "warning", message: "GSTIN does not look valid (imported anyway)" });
    return {
      issues,
      payload: {
        name: d.name,
        code: d.code || null,
        gstin: d.gstin ? d.gstin.toUpperCase() : null,
        state_code: d.state_code || null,
        address: d.address || null,
        phone: d.phone || null,
      },
    };
  }

  if (entity === "h1_register") {
    if (!d.drug_name) issues.push({ field: "drug_name", level: "error", message: "Missing drug name" });
    let schedule = (d.schedule || "").toUpperCase();
    if (!["H", "H1", "X"].includes(schedule)) {
      if (d.schedule) issues.push({ field: "schedule", level: "warning", message: `Unknown schedule "${d.schedule}", set to H1` });
      schedule = "H1";
    }
    const qty = Number((d.qty || "").replace(/[,\s]/g, ""));
    const soldAt = toIsoDate(d.date);
    return {
      issues,
      payload: {
        drug_name: d.drug_name,
        schedule,
        batch_no: d.batch_no || null,
        expiry: d.expiry || null,
        qty: Number.isFinite(qty) ? Math.trunc(qty) : 0,
        doctor_name: d.doctor_name || null,
        doctor_reg_no: d.doctor_reg_no || null,
        patient_name: d.patient_name || null,
        patient_address: d.patient_address || null,
        ...(soldAt ? { sold_at: soldAt } : {}),
      },
    };
  }

  if (entity === "drug_licenses") {
    if (!d.license_type) issues.push({ field: "license_type", level: "error", message: "Missing licence type" });
    if (!d.license_no) issues.push({ field: "license_no", level: "error", message: "Missing licence number" });
    return {
      issues,
      payload: {
        license_type: d.license_type,
        license_no: d.license_no,
        holder_name: d.holder_name || null,
        issued_date: toIsoDate(d.issued_date),
        expiry_date: toIsoDate(d.expiry_date),
        notes: d.notes || null,
      },
    };
  }

  if (entity === "gst_returns") {
    const period = toExpiryYM(d.period); // YYYY-MM
    if (!period) issues.push({ field: "period", level: "error", message: `Could not read period "${d.period}" (use YYYY-MM)` });
    const rt = (d.return_type || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const returnType = rt.includes("3B") ? "GSTR3B" : rt.includes("1") ? "GSTR1" : null;
    if (!returnType) issues.push({ field: "return_type", level: "error", message: "Return type must be GSTR1 or GSTR3B" });
    const status = (d.status || "").toLowerCase().includes("draft") ? "draft" : "filed";
    const filedAt = toIsoDate(d.filed_date);
    return {
      issues,
      payload: {
        period: period || "",
        return_type: returnType || "GSTR1",
        status,
        ...(filedAt ? { filed_at: filedAt } : {}),
      },
    };
  }

  if (entity === "invoice_series") {
    const docType = normalizeDocType(d.doc_type);
    if (!docType) issues.push({ field: "doc_type", level: "error", message: `Unrecognized doc type "${d.doc_type}" (sales / purchase / credit / debit / payment)` });
    if (!d.financial_year) issues.push({ field: "financial_year", level: "error", message: "Missing financial year" });
    const n = Number((d.next_number || "").replace(/[,\s]/g, ""));
    return {
      issues,
      payload: {
        doc_type: docType || "sales_invoice",
        financial_year: d.financial_year,
        prefix: d.prefix || null,
        next_number: Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1,
      },
    };
  }

  // batches — link by item code first (precise), then by name (fallback).
  if (!d.item && !d.item_code) {
    issues.push({ field: "item", level: "error", message: "Missing item code or name" });
  }
  const itemId =
    (d.item_code ? ctx.itemByCode?.get(d.item_code) : undefined) ??
    (d.item ? ctx.itemByName?.get(d.item.toLowerCase()) : undefined);
  if ((d.item || d.item_code) && !itemId) {
    const hint = d.item ? closest(d.item, ctx.itemNames ?? []) : null;
    issues.push({
      field: d.item_code && !d.item ? "item_code" : "item",
      level: "error",
      message: hint ? `Item not in catalogue. Did you mean "${hint}"?` : "Item not in catalogue",
    });
  }
  // Negative stock is a real-world value (oversold, or billed before the GRN
  // landed) — import it faithfully, don't quarantine. Only a non-empty,
  // non-numeric quantity warns (and saves as 0).
  const qty = Number((d.qty || "").replace(/[,\s]/g, ""));
  if (d.qty && !Number.isFinite(qty))
    issues.push({ field: "qty", level: "warning", message: `Quantity "${d.qty}" isn't a number: saved as 0` });
  // Opening stock: a zero-stock dormant item may carry no MRP — don't quarantine
  // the whole catalogue for that. Only block negatives; warn if it's in stock yet priceless.
  const mrp = Number((d.mrp || "").replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(mrp) || mrp < 0) issues.push({ field: "mrp", level: "error", message: "MRP must be a number ≥ 0" });
  else if (mrp === 0 && qty > 0) issues.push({ field: "mrp", level: "warning", message: "In stock but no MRP. Set it before billing" });
  let expiry: string | null = "";
  if (d.expiry) {
    expiry = toExpiryYM(d.expiry);
    if (!expiry) {
      issues.push({ field: "expiry", level: "error", message: `Could not read expiry "${d.expiry}" (use YYYY-MM)` });
    } else {
      const fiveYrsAgo = new Date();
      fiveYrsAgo.setFullYear(fiveYrsAgo.getFullYear() - 5);
      if (new Date(`${expiry}-01`) < fiveYrsAgo)
        issues.push({ field: "expiry", level: "error", message: "Expiry is more than 5 years old" });
    }
  }
  return {
    issues,
    payload: {
      item_id: itemId ?? null,
      batch_no: d.batch_no || null,
      expiry: expiry || null,
      qty: Number.isFinite(qty) ? Math.trunc(qty) : 0, // keep negatives as-is
      mrp_paise: toPaise(d.mrp),
      ptr_paise: toPaise(d.ptr),
    },
  };
}

/** Map + validate rows, splitting into valid (commit) and quarantined (fix). */
export function partitionRows(
  entity: EntityKey,
  rows: Record<string, string>[],
  mapping: Record<string, string | null>,
  ctx: ValidateCtx = {},
): Partition {
  const valid: RowResult[] = [];
  const quarantined: RowResult[] = [];
  rows.forEach((raw, index) => {
    const data = applyMapping(raw, mapping);
    if (Object.values(data).every((v) => !v)) return; // skip blank rows
    const { issues, payload } = validate(entity, data, ctx);
    const hasError = issues.some((i) => i.level === "error");
    // Keep the verbatim source row (every column, mapped or not) so nothing is
    // discarded — it lands in the entity's `source` jsonb (migration 0013).
    const result: RowResult = {
      index,
      data,
      issues,
      payload: hasError || !payload ? null : { ...payload, source: pruneEmpty(raw) },
    };
    (hasError ? quarantined : valid).push(result);
  });
  return { valid, quarantined };
}

/** Drop empty cells so `source` stays compact but loses nothing meaningful. */
function pruneEmpty(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (v != null && String(v).trim() !== "") out[k] = v;
  return out;
}

/** Re-validate a single edited quarantine row (used by the "Re-process" action). */
export function revalidate(entity: EntityKey, data: Record<string, string>, ctx: ValidateCtx = {}): RowResult {
  const { issues, payload } = validate(entity, data, ctx);
  const hasError = issues.some((i) => i.level === "error");
  // Reprocessed rows are hand-edited in the grid; keep the edited field map as source.
  return { index: -1, data, issues, payload: hasError || !payload ? null : { ...payload, source: pruneEmpty(data) } };
}
