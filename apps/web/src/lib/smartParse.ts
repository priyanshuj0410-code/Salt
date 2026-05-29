import Papa from "papaparse";
import * as XLSX from "xlsx";
import { extractTable, type FieldDef, type Table } from "@/lib/smartImport";
import { extractLedgerReport, type LedgerReport } from "@/lib/smartLedger";

/** Read a CSV / XLS / XLSX file into a raw sheet matrix (rows of cells). */
export async function readMatrix(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  return name.endsWith(".xls") || name.endsWith(".xlsx")
    ? readXlsxMatrix(file)
    : readCsvMatrix(file);
}

/**
 * Parse a CSV / XLS / XLSX file into a clean {headers, rows} table. The raw
 * sheet matrix is run through extractTable so messy accounting-report exports
 * (title blocks, interleaved transaction rows, footers) are handled, not just
 * clean tabular files.
 */
export async function parseFile(file: File, fields: FieldDef[]): Promise<Table> {
  return extractTable(await readMatrix(file), fields);
}

/**
 * Parse a Saral/Marg/Tally trial balance into ledgers with signed opening
 * balances and per-invoice open bills. Unlike parseFile (flat fields), this
 * keeps the nested bill rows under each ledger.
 */
export async function parseLedgerFile(file: File): Promise<LedgerReport> {
  return extractLedgerReport(await readMatrix(file));
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
