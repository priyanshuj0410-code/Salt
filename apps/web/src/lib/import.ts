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

export function templateCsv(): string {
  const header = IMPORT_COLUMNS.join(",");
  const examples = [
    "Dolo 650,Paracetamol 650mg,Micro Labs,Strip of 15 tablets,30049099,12,OTC,8901234500017,DL2411,2027-03,240,31.50,25.20",
    "Augmentin 625 Duo,Amoxicillin + Clavulanic Acid,GSK,Strip of 10 tablets,30041020,12,H,,AG2501,2026-08,60,223.40,187.70",
  ];
  return [header, ...examples].join("\n") + "\n";
}
