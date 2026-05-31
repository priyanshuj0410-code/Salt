import type { RowIssue } from "./import";

/**
 * GL opening-balance import (SALT-126) — the non-party side of a trial balance.
 * Party (debtor/creditor) openings already import via Smart Import (ledgers +
 * ledger_entries ref_table='opening'). This parses a simple GL-openings CSV
 * (account code/name, type, debit, credit) so Cash/Bank/Stock/Capital/loans/fixed
 * assets can be posted into the accounting backbone (chart_accounts +
 * Opening Balance Equity contra) via the import_gl_opening RPC. Pure + type-only
 * imports, so it unit-tests cleanly.
 */

export type AccountType = "asset" | "liability" | "income" | "expense" | "equity";

export interface ParsedGlAccount {
  code: string;
  name: string;
  /** null when the user left it blank or typed something unrecognized. */
  type: AccountType | null;
  debitPaise: number;
  creditPaise: number;
}

export interface GlOpeningResult {
  accounts: ParsedGlAccount[];
  issues: RowIssue[];
  totalDebitPaise: number;
  totalCreditPaise: number;
  errorCount: number;
  warningCount: number;
}

export type GlRawRow = Record<string, string | undefined>;

export const GL_OPENING_COLUMNS = ["code", "name", "type", "debit", "credit"] as const;

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const RAW_ALIASES: Record<string, string> = {
  accountcode: "code", accode: "code", ledgercode: "code", glcode: "code", accountno: "code", acno: "code",
  account: "name", accountname: "name", ledger: "name", ledgername: "name", particulars: "name",
  head: "name", accounthead: "name", glaccount: "name",
  accounttype: "type", group: "type", nature: "type", accountgroup: "type",
  dr: "debit", debitamount: "debit", dramount: "debit", openingdr: "debit", debitopening: "debit",
  cr: "credit", creditamount: "credit", cramount: "credit", openingcr: "credit", creditopening: "credit",
};

const HEADER_ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of GL_OPENING_COLUMNS) m[norm(c)] = c;
  for (const [k, v] of Object.entries(RAW_ALIASES)) m[k] = v;
  return m;
})();

export function canonicalGlHeader(raw: string): string {
  const n = norm(raw);
  return HEADER_ALIASES[n] ?? n;
}

const s = (v: string | undefined) => (v ?? "").trim();
function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeAccountType(raw: string): AccountType | null {
  const t = raw.trim().toLowerCase();
  if (["asset", "assets", "fixed asset", "fixed assets", "current asset", "current assets", "investment"].includes(t)) return "asset";
  if (["liability", "liabilities", "current liability", "current liabilities", "loan", "loans", "provision"].includes(t)) return "liability";
  if (["income", "revenue", "sales", "direct income", "indirect income"].includes(t)) return "income";
  if (["expense", "expenses", "direct expense", "indirect expense", "purchase"].includes(t)) return "expense";
  if (["equity", "capital", "capital account", "reserves", "reserve"].includes(t)) return "equity";
  return null;
}

const PARTY_CONTROL = /sundry\s+(debtor|creditor)|^debtors?$|^creditors?$/i;

export function parseGlOpening(rows: GlRawRow[]): GlOpeningResult {
  const accounts: ParsedGlAccount[] = [];
  const issues: RowIssue[] = [];
  let totalDebitPaise = 0;
  let totalCreditPaise = 0;

  rows.forEach((raw, i) => {
    const line = i + 2;
    const code = s(raw.code).toUpperCase();
    const name = s(raw.name);
    if (!name && !code) {
      issues.push({ row: line, level: "error", message: "Row needs an account name or code — skipped" });
      return;
    }
    const label = name || code;

    if (PARTY_CONTROL.test(name) || PARTY_CONTROL.test(code)) {
      issues.push({ row: line, level: "warning", message: `"${label}": debtor/creditor balances import from the ledger/trial-balance step, not here — skipped` });
      return;
    }

    const debit = num(raw.debit) ?? 0;
    const credit = num(raw.credit) ?? 0;
    if (debit < 0 || credit < 0) {
      issues.push({ row: line, level: "error", message: `"${label}": amounts cannot be negative` });
      return;
    }
    if (debit > 0 && credit > 0) {
      issues.push({ row: line, level: "error", message: `"${label}": put the opening under debit OR credit, not both` });
      return;
    }
    if (debit === 0 && credit === 0) {
      issues.push({ row: line, level: "error", message: `"${label}": no opening amount` });
      return;
    }

    let type: AccountType | null = null;
    const rawType = s(raw.type);
    if (rawType) {
      type = normalizeAccountType(rawType);
      if (!type) {
        issues.push({ row: line, level: "warning", message: `"${label}": unrecognized type "${rawType}" — needed only if this account is new` });
      }
    }

    accounts.push({
      code,
      name: name || code,
      type,
      debitPaise: Math.round(debit * 100),
      creditPaise: Math.round(credit * 100),
    });
    totalDebitPaise += Math.round(debit * 100);
    totalCreditPaise += Math.round(credit * 100);
  });

  return {
    accounts,
    issues,
    totalDebitPaise,
    totalCreditPaise,
    errorCount: issues.filter((p) => p.level === "error").length,
    warningCount: issues.filter((p) => p.level === "warning").length,
  };
}

export function glOpeningPayload(accounts: ParsedGlAccount[]) {
  return accounts.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    debit_paise: a.debitPaise,
    credit_paise: a.creditPaise,
  }));
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function glOpeningTemplateCsv(): string {
  const rows: string[][] = [
    [...GL_OPENING_COLUMNS],
    ["CASH", "Cash", "asset", "50000", ""],
    ["BANK", "Bank", "asset", "200000", ""],
    ["STOCK", "Opening Stock", "asset", "180000", ""],
    ["CAPITAL", "Capital Account", "equity", "", "430000"],
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
