export type EntityKey = "ledgers" | "items" | "batches";

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
}

export const ENTITIES: EntityConfig[] = [
  {
    key: "ledgers",
    label: "Ledgers",
    order: 0,
    description: "Your parties — customers and suppliers/distributors. Import these first.",
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
    key: "items",
    label: "Items",
    order: 1,
    description: "Your product master — medicines and surgicals with salt, tax and schedule.",
    tip: "Missing HSN is allowed (flagged as a warning); an unknown Schedule defaults to OTC.",
    fields: [
      { key: "name", label: "Name", required: true, aliases: ["item", "product", "medicine", "item name", "product name", "description"] },
      { key: "salt", label: "Salt", aliases: ["molecule", "composition", "generic", "content"] },
      { key: "manufacturer", label: "Manufacturer", aliases: ["company", "mfr", "maker", "brand", "comp"] },
      { key: "pack", label: "Pack", aliases: ["packing", "pack size", "unit"] },
      { key: "hsn", label: "HSN", aliases: ["hsn code", "hsncode"] },
      { key: "gst_rate", label: "GST %", aliases: ["gst", "tax", "tax slab", "gst rate", "tax %"] },
      { key: "schedule", label: "Schedule", aliases: ["sch", "drug schedule"] },
      { key: "barcode", label: "Barcode", aliases: ["ean", "upc", "bar code"] },
    ],
  },
  {
    key: "batches",
    label: "Batches & stock",
    order: 2,
    description: "Your physical stock — one row per batch, linked to an item by name.",
    tip: "Import Items first. Rows whose item is not found are quarantined with a closest-match suggestion.",
    fields: [
      { key: "item", label: "Item", required: true, aliases: ["product", "medicine", "item name", "name"] },
      { key: "batch_no", label: "Batch no", aliases: ["batch", "batch number", "lot", "lot no"] },
      { key: "expiry", label: "Expiry", aliases: ["exp", "exp date", "expiry date", "exp dt", "expdate"] },
      { key: "qty", label: "Quantity", required: true, aliases: ["quantity", "stock", "qty on hand", "closing stock", "balance"] },
      { key: "mrp", label: "MRP", required: true, aliases: ["rate", "price", "sale rate", "mrp rate"] },
      { key: "ptr", label: "Purchase price", aliases: ["ptr", "purchase rate", "purchase price", "cost", "buy rate"] },
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

/** Best similarity of a header against a field's label/key/aliases. */
function fieldScore(field: FieldDef, header: string): number {
  const h = norm(header);
  const candidates = [field.label, field.key, ...field.aliases].map(norm);
  let best = 0;
  for (const c of candidates) {
    if (c === h || h.includes(c) || c.includes(h)) return 1;
    best = Math.max(best, similarity(c, h));
  }
  return best;
}

/** Suggest a mapping of field key -> source header (or null) for a file. */
export function autoMap(headers: string[], fields: FieldDef[], threshold = 0.72): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const field of fields) {
    let bestHeader: string | null = null;
    let bestScore = threshold;
    for (const header of headers) {
      const s = fieldScore(field, header);
      if (s >= bestScore) {
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
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function toPaise(s: string): number {
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

  // batches
  if (!d.item) {
    issues.push({ field: "item", level: "error", message: "Missing item name" });
  }
  const itemId = d.item ? ctx.itemByName?.get(d.item.toLowerCase()) : undefined;
  if (d.item && !itemId) {
    const hint = closest(d.item, ctx.itemNames ?? []);
    issues.push({
      field: "item",
      level: "error",
      message: hint ? `Item not in catalogue. Did you mean "${hint}"?` : "Item not in catalogue",
    });
  }
  const qty = Number(d.qty);
  if (!Number.isFinite(qty) || qty < 0) issues.push({ field: "qty", level: "error", message: "Quantity must be a number ≥ 0" });
  const mrp = Number((d.mrp || "").replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(mrp) || mrp <= 0) issues.push({ field: "mrp", level: "error", message: "MRP must be greater than 0" });
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
      qty: Math.max(0, Math.floor(qty || 0)),
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
    const result: RowResult = { index, data, issues, payload: hasError ? null : payload };
    (hasError ? quarantined : valid).push(result);
  });
  return { valid, quarantined };
}

/** Re-validate a single edited quarantine row (used by the "Re-process" action). */
export function revalidate(entity: EntityKey, data: Record<string, string>, ctx: ValidateCtx = {}): RowResult {
  const { issues, payload } = validate(entity, data, ctx);
  const hasError = issues.some((i) => i.level === "error");
  return { index: -1, data, issues, payload: hasError ? null : payload };
}
