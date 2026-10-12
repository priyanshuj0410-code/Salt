import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileUp, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { isMissingFunctionError } from "@/lib/import";
import {
  canonicalGlHeader,
  glOpeningPayload,
  glOpeningTemplateCsv,
  parseGlOpening,
  type GlOpeningResult,
  type GlRawRow,
  type ParsedGlAccount,
} from "@/lib/importGlOpening";

interface AccountRow { code: string | null; name: string }

async function loadAccounts(orgId: string): Promise<AccountRow[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("chart_accounts").select("code,name").eq("org_id", orgId);
  return (data as AccountRow[]) ?? [];
}

function downloadTemplate() {
  const blob = new Blob([glOpeningTemplateCsv()], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "salt-gl-opening-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

interface Report { posted: number; created: number; skipped: number }

export function GlOpeningImportPage() {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<GlOpeningResult | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    loadAccounts(orgId).then((rows) => {
      if (active) setAccounts(rows);
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  const { existingCodes, existingNames } = useMemo(() => {
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const a of accounts) {
      if (a.code) codes.add(a.code.toUpperCase());
      names.add(a.name.toLowerCase());
    }
    return { existingCodes: codes, existingNames: names };
  }, [accounts]);

  function isOnFile(a: ParsedGlAccount): boolean {
    if (a.code && existingCodes.has(a.code.toUpperCase())) return true;
    return existingNames.has(a.name.toLowerCase());
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setError(null);
    Papa.parse<GlRawRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: canonicalGlHeader,
      complete: (res) => setResult(parseGlOpening(res.data)),
    });
  }

  const newMissingType = result ? result.accounts.filter((a) => !isOnFile(a) && !a.type).length : 0;
  const diffPaise = result ? result.totalDebitPaise - result.totalCreditPaise : 0;

  async function doImport() {
    if (!supabase || !orgId || !result) return;
    setImporting(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("import_gl_opening", {
        p_lines: glOpeningPayload(result.accounts),
      });
      if (rpcErr) {
        if (isMissingFunctionError(rpcErr)) {
          setError("GL import needs migration 0029 to be applied in Supabase. Ask your admin to run it, then retry.");
          return;
        }
        setError(`${rpcErr.message}: nothing posted (rolled back).`);
        return;
      }
      const r = (data ?? {}) as Report;
      setAccounts(await loadAccounts(orgId));
      setReport({ posted: r.posted ?? 0, created: r.created ?? 0, skipped: r.skipped ?? 0 });
      setResult(null);
      setFileName(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Page width="sm">
      <Link to="/import" className="text-sm font-medium text-text-tertiary hover:text-foreground">
        ← Import
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Import opening balances (GL)</h1>
      <p className="mt-1 text-sm text-text-tertiary">
        Seed your ledger accounts: Cash, Bank, Stock, Capital, loans, fixed assets, with their opening balances
        as one balanced opening entry. Customer and vendor balances come in through{" "}
        <Link to="/import/smart" className="font-medium text-primary hover:underline">Smart Import</Link> (the
        trial-balance step), not here.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" onClick={downloadTemplate}>
          <Download />
          Download template
        </Button>
        <label htmlFor="gl-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
          <FileUp />
          {fileName ?? "Choose CSV file"}
        </label>
        <input id="gl-file" type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </div>

      {report && (
        <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Posted opening balances for {report.posted} {report.posted === 1 ? "account" : "accounts"}.
          </p>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Created {report.created} new {report.created === 1 ? "account" : "accounts"}
            {report.skipped > 0 ? ` · skipped ${report.skipped} that already had an opening` : ""}.
          </p>
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b bg-surface-2/30 px-3 py-2">
            <span className="text-xs font-medium">Dry run: preview only, nothing posted yet</span>
            <span className="text-xs text-text-tertiary">
              {result.accounts.length} accounts
              {result.errorCount > 0 ? ` · ${result.errorCount} errors` : ""}
              {result.warningCount > 0 ? ` · ${result.warningCount} warnings` : ""}
            </span>
          </div>

          <div className="grid grid-cols-3 divide-x border-b text-center text-sm">
            <div className="px-2 py-2">
              <div className="font-semibold tabular-nums">{formatPaise(result.totalDebitPaise)}</div>
              <div className="text-xs text-text-tertiary">Total debit</div>
            </div>
            <div className="px-2 py-2">
              <div className="font-semibold tabular-nums">{formatPaise(result.totalCreditPaise)}</div>
              <div className="text-xs text-text-tertiary">Total credit</div>
            </div>
            <div className="px-2 py-2">
              <div className={`font-semibold tabular-nums ${diffPaise === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-500"}`}>
                {diffPaise === 0 ? "Balanced" : formatPaise(Math.abs(diffPaise))}
              </div>
              <div className="text-xs text-text-tertiary">{diffPaise === 0 ? "Dr = Cr" : "to OB Equity"}</div>
            </div>
          </div>

          {result.accounts.length > 0 && (
            <ul className="max-h-72 divide-y overflow-auto text-sm">
              {result.accounts.map((a, i) => {
                const onFileAcct = isOnFile(a);
                const needsType = !onFileAcct && !a.type;
                return (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate">
                      {a.code && <span className="font-mono text-xs text-text-tertiary">{a.code} </span>}
                      {a.name}
                    </span>
                    <Badge variant={onFileAcct ? "secondary" : "outline"}>{onFileAcct ? "on file" : "new"}</Badge>
                    {needsType && <Badge variant="destructive">needs type</Badge>}
                    <span className="w-24 text-right tabular-nums">
                      {a.debitPaise > 0 ? formatPaise(a.debitPaise) : ""}
                    </span>
                    <span className="w-24 text-right tabular-nums">
                      {a.creditPaise > 0 ? formatPaise(a.creditPaise) : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {result.issues.length > 0 && (
            <ul className="max-h-44 divide-y overflow-auto border-t text-sm">
              {result.issues.map((p, i) => (
                <li key={i} className="flex gap-2 px-3 py-1.5">
                  <span className="text-text-tertiary">Row {p.row}</span>
                  <span className={p.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-500"}>
                    {p.level === "error" ? "Error" : "Warning"}:
                  </span>
                  <span>{p.message}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t p-3">
            <p className="text-xs text-text-tertiary">
              {newMissingType > 0
                ? `${newMissingType} new account(s) need a type before they can be created.`
                : "Posted as one balanced opening entry. Re-running skips accounts that already have an opening."}
            </p>
            <Button onClick={doImport} disabled={importing || result.accounts.length === 0 || result.errorCount > 0 || newMissingType > 0}>
              <Upload />
              {importing ? "Posting…" : `Post ${result.accounts.length} openings`}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </Page>
  );
}
