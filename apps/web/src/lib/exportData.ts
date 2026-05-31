import { format } from "date-fns";
import { supabase } from "./supabase";

/** One exportable dataset, mapped to its Postgres table. */
export interface ExportDataset {
  table: string;
  label: string;
  hint: string;
}

/**
 * The business data an owner would want to take with them — masters +
 * transactions. Every table here is org-scoped (`org_id`) and RLS-protected,
 * so a fetch only ever returns the caller's own org.
 */
export const EXPORT_DATASETS: ExportDataset[] = [
  { table: "ledgers", label: "Parties", hint: "Customers, vendors & other ledgers" },
  { table: "items", label: "Catalogue", hint: "Item master" },
  { table: "sales_invoices", label: "Sales invoices", hint: "Invoice headers" },
  { table: "sale_lines", label: "Sale lines", hint: "Invoice line items" },
  { table: "purchases", label: "Purchases (GRN)", hint: "Goods-receipt headers" },
  { table: "purchase_lines", label: "Purchase lines", hint: "GRN line items" },
  { table: "payments", label: "Payments", hint: "Money received & paid" },
  { table: "stock_movements", label: "Stock movements", hint: "Every stock in / out" },
  { table: "ledger_entries", label: "Ledger entries", hint: "Double-entry GL postings" },
  { table: "drug_licenses", label: "Drug licenses", hint: "Drugs & Cosmetics licenses" },
];

type Row = Record<string, unknown>;

const PAGE = 1000;

/** Fetch every row of `table` for the org, paging past PostgREST's 1000 cap. */
export async function fetchDataset(table: string, orgId: string): Promise<Row[]> {
  if (!supabase) return [];
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("org_id", orgId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data as Row[] | null) ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

/** Exact row count for the org without pulling the rows. */
export async function countDataset(table: string, orgId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // RFC 4180: quote when the value contains a comma, quote, or newline.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV. Header is the union of all keys (first-seen order). */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const lines = [keys.map(csvCell).join(",")];
  for (const r of rows) lines.push(keys.map((k) => csvCell(r[k])).join(","));
  return lines.join("\r\n");
}

/** Trigger a client-side file download from an in-memory string. */
export function triggerDownload(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Filename-safe timestamp, e.g. 2026-06-01-1432. */
export const stamp = (): string => format(new Date(), "yyyy-MM-dd-HHmm");
