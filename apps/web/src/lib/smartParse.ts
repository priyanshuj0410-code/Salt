import Papa from "papaparse";
import * as XLSX from "xlsx";
import { extractTable, type FieldDef, type Table } from "@/lib/smartImport";

/**
 * Parse a CSV / XLS / XLSX file into a clean {headers, rows} table. The raw
 * sheet matrix is run through extractTable so messy accounting-report exports
 * (title blocks, interleaved transaction rows, footers) are handled, not just
 * clean tabular files.
 */
export async function parseFile(file: File, fields: FieldDef[]): Promise<Table> {
  const name = file.name.toLowerCase();
  const matrix = name.endsWith(".xls") || name.endsWith(".xlsx")
    ? await readXlsxMatrix(file)
    : await readCsvMatrix(file);
  return extractTable(matrix, fields);
}

function readCsvMatrix(file: File): Promise<string[][]> {
  return new Promise((resolve) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: false,
      complete: (res) => resolve(res.data),
    });
  });
}

async function readXlsxMatrix(file: File): Promise<string[][]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}
