import type { Schedule } from "./types";

/** CSV columns. Only name, qty, mrp are required; the rest are optional. */
export const IMPORT_COLUMNS = [
  "name",
  "salt",
  "manufacturer",
  "pack",
  "hsn",
  "gst_rate",
  "schedule",
  "barcode",
  "batch_no",
  "expiry",
  "qty",
  "mrp",
  "ptr",
] as const;

/**
 * Normalize a header to a comparison key: lower-case, strip everything that is
 * not a-z0-9. So "Item Name", "item_name" and "ITEMNAME" all collapse to the
 * same key, and "GST%" / "HSN/SAC" lose their punctuation.
 */
function normKey(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Vendor header → canonical column. Keyed by `normKey` form so Marg/Tally exports
 * (and the Marg/Tally starter templates below) drop straight into the fixed-template
 * importer without the full Smart Import fuzzy mapping. Mirrors the alias knowledge in
 * lib/smartImport.ts, narrowed to the 13 catalogue columns this importer reads.
 */
const RAW_ALIASES: Record<string, string> = {
  itemname: "name", nameofitem: "name", item: "name", product: "name", productname: "name",
  medicine: "name", description: "name", particulars: "name",
  molecule: "salt", composition: "salt", generic: "salt", content: "salt",
  company: "manufacturer", mfr: "manufacturer", maker: "manufacturer", brand: "manufacturer",
  comp: "manufacturer", manufacturername: "manufacturer",
  packing: "pack", packsize: "pack", unit: "pack",
  hsncode: "hsn", hsnsac: "hsn", hsnsaccode: "hsn",
  gst: "gst_rate", gstrate: "gst_rate", gstpercent: "gst_rate", igst: "gst_rate",
  tax: "gst_rate", taxslab: "gst_rate", taxpercent: "gst_rate",
  sch: "schedule", drugschedule: "schedule",
  ean: "barcode", upc: "barcode",
  batch: "batch_no", batchno: "batch_no", batchnumber: "batch_no", lot: "batch_no", lotno: "batch_no",
  exp: "expiry", expdate: "expiry", expirydate: "expiry", expdt: "expiry",
  quantity: "qty", stock: "qty", closingstock: "qty", closingqty: "qty",
  closingquantity: "qty", qtyonhand: "qty", balance: "qty", closingbal: "qty",
  rate: "mrp", price: "mrp", salerate: "mrp", mrprate: "mrp", closingrate: "mrp",
  purchaserate: "ptr", purchaseprice: "ptr", cost: "ptr", buyrate: "ptr",
  standardcost: "ptr", landingcost: "ptr",
};

/** Final lookup: each canonical column maps to itself, plus every vendor alias. */
const HEADER_ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of IMPORT_COLUMNS) m[normKey(c)] = c; // "gstrate" → "gst_rate", "batchno" → "batch_no"
  for (const [k, v] of Object.entries(RAW_ALIASES)) m[k] = v;
  return m;
})();

/**
 * Papa `transformHeader`: map any incoming header to its canonical column, so
 * `validateRows` can read `raw.name` / `raw.qty` / `raw.mrp` regardless of whether
 * the file came from the Salt, Marg or Tally template. Unknown headers fall through
 * (normalized) and are simply ignored downstream.
 */
export function canonicalHeader(raw: string): string {
  const n = normKey(raw);
  return HEADER_ALIASES[n] ?? n;
}

export type RawRow = Record<string, string | undefined>;

export interface ParsedBatch {
  batchNo: string;
  expiry: string;
  qty: number;
  mrpPaise: number;
  ptrPaise: number;
}

export interface ParsedItem {
  key: string;
  name: string;
  salt: string;
  manufacturer: string;
  pack: string;
  hsn: string;
  gstRate: number;
  schedule: Schedule;
  barcode: string | null;
  batches: ParsedBatch[];
}

export interface RowIssue {
  row: number;
  level: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  items: ParsedItem[];
  batchCount: number;
  issues: RowIssue[];
  errorCount: number;
  warningCount: number;
}

const SCHEDULES: Schedule[] = ["OTC", "H", "H1", "X"];

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

const s = (v: string | undefined) => (v ?? "").trim();

export function validateRows(rows: RawRow[]): ValidationResult {
  const items = new Map<string, ParsedItem>();
  const issues: RowIssue[] = [];
  let batchCount = 0;

  rows.forEach((raw, i) => {
    const line = i + 2; // +1 for header, +1 for 1-based
    const name = s(raw.name);
    if (!name) {
      issues.push({ row: line, level: "error", message: "Missing item name — row skipped" });
      return;
    }

    const qty = num(raw.qty);
    if (qty == null || qty < 0 || !Number.isInteger(qty)) {
      issues.push({ row: line, level: "error", message: `"${name}": quantity must be a whole number ≥ 0` });
      return;
    }
    if (qty === 0) {
      issues.push({ row: line, level: "warning", message: `"${name}": quantity is 0` });
    }

    const mrp = num(raw.mrp);
    if (mrp == null || mrp <= 0) {
      issues.push({ row: line, level: "error", message: `"${name}": MRP must be greater than 0` });
      return;
    }

    const ptr = num(raw.ptr) ?? 0;
    if (ptr > mrp) {
      issues.push({ row: line, level: "warning", message: `"${name}": purchase price exceeds MRP` });
    }

    const gstRate = num(raw.gst_rate) ?? 0;

    let schedule: Schedule = "OTC";
    const rawSched = s(raw.schedule).toUpperCase();
    if (rawSched && SCHEDULES.includes(rawSched as Schedule)) {
      schedule = rawSched as Schedule;
    } else if (rawSched) {
      issues.push({ row: line, level: "warning", message: `"${name}": unknown schedule "${rawSched}", defaulted to OTC` });
    }

    const expiry = s(raw.expiry);
    if (expiry && !/^\d{4}-\d{2}$/.test(expiry)) {
      issues.push({ row: line, level: "warning", message: `"${name}": expiry "${expiry}" is not YYYY-MM` });
    }

    const manufacturer = s(raw.manufacturer);
    const key = `${name.toLowerCase()}|${manufacturer.toLowerCase()}`;
    let item = items.get(key);
    if (!item) {
      item = {
        key,
        name,
        salt: s(raw.salt),
        manufacturer,
        pack: s(raw.pack),
        hsn: s(raw.hsn),
        gstRate,
        schedule,
        barcode: s(raw.barcode) || null,
        batches: [],
      };
      items.set(key, item);
    }
    item.batches.push({
      batchNo: s(raw.batch_no),
      expiry,
      qty,
      mrpPaise: Math.round(mrp * 100),
      ptrPaise: Math.round(ptr * 100),
    });
    batchCount++;
  });

  return {
    items: [...items.values()],
    batchCount,
    issues,
    errorCount: issues.filter((p) => p.level === "error").length,
    warningCount: issues.filter((p) => p.level === "warning").length,
  };
}

/** A downloadable starter template shaped like a given source system. */
export interface ImportTemplate {
  id: "salt" | "marg" | "tally";
  label: string;
  description: string;
  filename: string;
  headers: string[];
  /** Example rows, each cell aligned to `headers`. */
  examples: string[][];
}

type Canonical = (typeof IMPORT_COLUMNS)[number];
interface TemplateDef {
  id: ImportTemplate["id"];
  label: string;
  description: string;
  filename: string;
  /** Vendor-facing header paired with the canonical column it feeds. */
  columns: { header: string; key: Canonical }[];
}

/** Two worked example items, keyed by canonical column, reused across templates. */
const EXAMPLES: Record<Canonical, string>[] = [
  { name: "Dolo 650", salt: "Paracetamol 650mg", manufacturer: "Micro Labs", pack: "Strip of 15 tablets", hsn: "30049099", gst_rate: "12", schedule: "OTC", barcode: "8901234500017", batch_no: "DL2411", expiry: "2027-03", qty: "240", mrp: "31.50", ptr: "25.20" },
  { name: "Augmentin 625 Duo", salt: "Amoxicillin + Clavulanic Acid", manufacturer: "GSK", pack: "Strip of 10 tablets", hsn: "30041020", gst_rate: "12", schedule: "H", barcode: "", batch_no: "AG2501", expiry: "2026-08", qty: "60", mrp: "223.40", ptr: "187.70" },
];

const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: "salt",
    label: "Salt",
    description: "Salt's own columns. Only name, qty and MRP are required; one row per batch.",
    filename: "salt-catalog-template.csv",
    columns: IMPORT_COLUMNS.map((k) => ({ header: k, key: k })),
  },
  {
    id: "marg",
    label: "Marg",
    description: "Shaped like a Marg item/stock export (Item Name, Company, Batch, MRP, PTR…).",
    filename: "salt-import-marg-template.csv",
    columns: [
      { header: "Item Name", key: "name" },
      { header: "Salt", key: "salt" },
      { header: "Company", key: "manufacturer" },
      { header: "Pack", key: "pack" },
      { header: "HSN Code", key: "hsn" },
      { header: "GST%", key: "gst_rate" },
      { header: "Schedule", key: "schedule" },
      { header: "Barcode", key: "barcode" },
      { header: "Batch No", key: "batch_no" },
      { header: "Expiry", key: "expiry" },
      { header: "Closing Qty", key: "qty" },
      { header: "MRP", key: "mrp" },
      { header: "PTR", key: "ptr" },
    ],
  },
  {
    id: "tally",
    label: "Tally",
    description: "Shaped like a Tally stock-item export (Name of Item, HSN/SAC, Closing Quantity, Rate…).",
    filename: "salt-import-tally-template.csv",
    columns: [
      { header: "Name of Item", key: "name" },
      { header: "HSN/SAC", key: "hsn" },
      { header: "GST Rate", key: "gst_rate" },
      { header: "Batch", key: "batch_no" },
      { header: "Expiry", key: "expiry" },
      { header: "Closing Quantity", key: "qty" },
      { header: "Rate", key: "mrp" },
      { header: "Purchase Rate", key: "ptr" },
    ],
  },
];

export const IMPORT_TEMPLATES: ImportTemplate[] = TEMPLATE_DEFS.map((d) => ({
  id: d.id,
  label: d.label,
  description: d.description,
  filename: d.filename,
  headers: d.columns.map((c) => c.header),
  examples: EXAMPLES.map((ex) => d.columns.map((c) => ex[c.key] ?? "")),
}));

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function templateCsvFor(id: ImportTemplate["id"]): string {
  const t = IMPORT_TEMPLATES.find((x) => x.id === id) ?? IMPORT_TEMPLATES[0];
  return [t.headers, ...t.examples].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** Back-compat default (Salt shape). */
export function templateCsv(): string {
  return templateCsvFor("salt");
}
