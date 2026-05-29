import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parse a user-supplied CSV / XLS / XLSX file into headers + string rows. */
export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return parseXlsx(file);
  return parseCsv(file);
}

function parseCsv(file: File): Promise<ParsedFile> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => resolve({ headers: res.meta.fields ?? [], rows: res.data }),
    });
  });
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = matrix[0].map((h) => String(h ?? "").trim());
  const rows = matrix.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = String(r[i] ?? "").trim()));
    return obj;
  });
  return { headers, rows };
}
