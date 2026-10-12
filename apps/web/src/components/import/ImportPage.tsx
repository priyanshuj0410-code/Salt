import { useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileUp, KeyRound, Landmark, PackagePlus, Upload, Wand2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import {
  canonicalHeader,
  isMissingFunctionError,
  itemsToImportPayload,
  templateCsvFor,
  validateRows,
  IMPORT_TEMPLATES,
  type ImportTemplate,
  type RawRow,
  type ValidationResult,
} from "@/lib/import";

function downloadTemplate(t: ImportTemplate) {
  const blob = new Blob([templateCsvFor(t.id)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = t.filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportPage() {
  const { membership } = useAuth();
  const loadCatalog = useCatalog((s) => s.load);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ items: number; batches: number } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

  async function generateToken() {
    if (!supabase) return;
    setTokenBusy(true);
    try {
      const { data, error: err } = await supabase.rpc("create_migration_token");
      if (err) setError(err.message);
      else setToken(data as string);
    } finally {
      setTokenBusy(false);
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setDone(null);
    setError(null);
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: canonicalHeader,
      complete: (res) => setResult(validateRows(res.data)),
    });
  }

  async function doImport() {
    if (!supabase || !membership || !result) return;
    setImporting(true);
    setError(null);
    try {
      const orgId = membership.orgId;
      // Preferred path: one atomic RPC — any failure rolls the whole import back.
      const { data, error: rpcErr } = await supabase.rpc("import_catalog", {
        p_items: itemsToImportPayload(result.items),
      });
      if (rpcErr) {
        if (isMissingFunctionError(rpcErr)) {
          await legacyImport(orgId); // migration 0028 not applied yet
          return;
        }
        // The transaction already rolled back server-side — catalogue unchanged.
        setError(`${rpcErr.message}: nothing was imported (rolled back).`);
        return;
      }
      const counts = (data ?? {}) as { items?: number; batches?: number };
      await loadCatalog(orgId);
      setDone({ items: counts.items ?? result.items.length, batches: counts.batches ?? 0 });
      setResult(null);
      setFileName(null);
    } finally {
      setImporting(false);
    }
  }

  // Fallback for before 0028 is applied: the legacy multi-step insert, now with a
  // best-effort compensating rollback so a mid-import failure still leaves the
  // catalogue clean rather than half-imported.
  async function legacyImport(orgId: string) {
    if (!supabase || !result) return;
    const { data: inserted, error: itemErr } = await supabase
      .from("items")
      .insert(
        result.items.map((it) => ({
          org_id: orgId,
          name: it.name,
          salt: it.salt || null,
          manufacturer: it.manufacturer || null,
          pack: it.pack || null,
          hsn: it.hsn || null,
          gst_rate: it.gstRate,
          schedule: it.schedule,
          barcode: it.barcode,
        })),
      )
      .select("id,name,manufacturer");
    if (itemErr) {
      setError(itemErr.message);
      return;
    }

    const insertedIds = (inserted ?? []).map((r) => r.id);
    const idByKey = new Map<string, string>();
    for (const row of inserted ?? []) {
      idByKey.set(`${row.name.toLowerCase()}|${(row.manufacturer ?? "").toLowerCase()}`, row.id);
    }

    const batchPayload = result.items.flatMap((it) => {
      const itemId = idByKey.get(it.key);
      if (!itemId) return [];
      return it.batches.map((b) => ({
        org_id: orgId,
        item_id: itemId,
        batch_no: b.batchNo || null,
        expiry: b.expiry || null,
        qty: b.qty,
        mrp_paise: b.mrpPaise,
        ptr_paise: b.ptrPaise,
      }));
    });

    for (let i = 0; i < batchPayload.length; i += 500) {
      const { error: bErr } = await supabase.from("batches").insert(batchPayload.slice(i, i + 500));
      if (bErr) {
        if (insertedIds.length) {
          await supabase.from("batches").delete().in("item_id", insertedIds);
          await supabase.from("items").delete().in("id", insertedIds);
        }
        setError(`${bErr.message}: import rolled back, nothing was saved.`);
        return;
      }
    }

    await loadCatalog(orgId);
    setDone({ items: result.items.length, batches: batchPayload.length });
    setResult(null);
    setFileName(null);
  }

  return (
    <Page width="sm">
        <h1 className="text-xl font-semibold">Import your catalogue</h1>

        <Link
          to="/import/smart"
          className="mt-4 flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 hover:bg-primary/10"
        >
          <Wand2 className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Smart import (recommended)</p>
            <p className="text-sm text-text-tertiary">
              Drag in your raw Marg/Tally Excel or CSV. It auto-maps the columns and quarantines
              only the rows that need a fix. Handles ledgers, items, and stock in order.
            </p>
          </div>
          <span className="self-center text-primary">→</span>
        </Link>

        <Link
          to="/purchases/scan"
          className="mt-3 flex items-start gap-3 rounded-lg border p-4 hover:bg-surface-2/40"
        >
          <PackagePlus className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Scan or import invoices (PDF · image · CSV)</p>
            <p className="text-sm text-text-tertiary">
              Upload vendor bills: PDFs, photos, or CSVs, to post as GRNs (stock, payable, ITC). Several files
              extract in the background; review and post from scan history. Missing vendors and items are created.
            </p>
          </div>
          <span className="self-center text-primary">→</span>
        </Link>

        <Link
          to="/import/gl"
          className="mt-3 flex items-start gap-3 rounded-lg border p-4 hover:bg-surface-2/40"
        >
          <Landmark className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Import opening balances (GL)</p>
            <p className="text-sm text-text-tertiary">
              Seed Cash, Bank, Stock, Capital and other ledger accounts with their opening balances as one
              balanced entry.
            </p>
          </div>
          <span className="self-center text-primary">→</span>
        </Link>

        <h2 className="mt-6 border-t pt-5 text-sm font-medium">Or start from a template</h2>
        <p className="mt-1 text-sm text-text-tertiary">
          Already export from Marg or Tally? Download that shape: Salt reads those column names automatically.
          Only <code className="rounded bg-surface-2 px-1">name</code>,{" "}
          <code className="rounded bg-surface-2 px-1">qty</code> and <code className="rounded bg-surface-2 px-1">mrp</code>{" "}
          are required. One row per batch.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {IMPORT_TEMPLATES.map((t) => (
            <Button key={t.id} variant="outline" size="sm" onClick={() => downloadTemplate(t)} title={t.description}>
              <Download />
              {t.label} template
            </Button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          <label htmlFor="csv-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
            <FileUp />
            {fileName ?? "Choose CSV file"}
          </label>
          <input id="csv-file" type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </div>

        {done && (
          <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
            <p className="font-medium text-emerald-700 dark:text-emerald-400">
              Imported {done.items} items and {done.batches} batches.
            </p>
            <Link to="/" className="mt-1 inline-block font-medium text-primary hover:underline">
              Go to billing →
            </Link>
          </div>
        )}

        {result && (
          <div className="mt-6 rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b bg-surface-2/30 px-3 py-2">
              <span className="text-xs font-medium">Dry run: preview only, nothing saved yet</span>
              <span className="text-xs text-text-tertiary">
                Will create {result.items.length} items · {result.batchCount} batches
              </span>
            </div>
            <div className="grid grid-cols-4 divide-x border-b text-center">
              <Stat label="Items" value={result.items.length} />
              <Stat label="Batches" value={result.batchCount} />
              <Stat label="Errors" value={result.errorCount} tone={result.errorCount ? "bad" : undefined} />
              <Stat label="Warnings" value={result.warningCount} tone={result.warningCount ? "warn" : undefined} />
            </div>

            {result.issues.length > 0 && (
              <ul className="max-h-64 divide-y overflow-auto text-sm">
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
                {result.errorCount > 0
                  ? "Fix the errors in your CSV and re-upload."
                  : "Imported as one transaction: if anything fails, nothing is saved. Re-importing the same file adds rows again (no dedupe yet)."}
              </p>
              <Button onClick={doImport} disabled={importing || result.items.length === 0 || result.errorCount > 0}>
                <Upload />
                {importing ? "Importing…" : `Import ${result.items.length} items`}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Migrate from Marg</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            Run the Salt Migrator on the PC that holds your Marg data. It reads Marg read-only and
            uploads straight into this org.
          </p>

          <ol className="mt-4 space-y-4 text-sm">
            <li>
              <span className="font-medium">1. Download the migrator</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <a download href="/downloads/salt-migrator-windows-x64.exe" className={cn(buttonVariants({ variant: "outline" }))}>
                  <Download />
                  Windows 64-bit
                </a>
                <a download href="/downloads/salt-migrator-windows-x86.exe" className={cn(buttonVariants({ variant: "outline" }))}>
                  <Download />
                  Windows 32-bit
                </a>
              </div>
            </li>

            <li>
              <span className="font-medium">2. Generate an upload token</span>
              <p className="text-xs text-text-tertiary">Scoped to this org · one-time · expires in 24h.</p>
              <div className="mt-1.5">
                <Button variant="outline" onClick={generateToken} disabled={tokenBusy}>
                  <KeyRound />
                  {tokenBusy ? "Generating…" : "Generate upload token"}
                </Button>
              </div>
              {token && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={token}
                      onFocus={(e) => e.currentTarget.select()}
                      className="h-8 flex-1 rounded-md border border-input bg-surface-2 px-2 font-mono text-xs"
                      aria-label="Migration token"
                    />
                    <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(token)}>
                      Copy
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-text-tertiary">Treat it like a password.</p>
                </div>
              )}
            </li>

            <li>
              <span className="font-medium">3. Run it on your Marg PC</span>
              <p className="mt-1 text-xs text-text-tertiary">In a command prompt, from where you saved it:</p>
              <pre className="mt-1.5 overflow-auto rounded-md bg-surface-2 p-2 font-mono text-xs">salt-migrator-windows-x64.exe --dbf "C:\Marg\items.dbf" --upload --token YOUR_TOKEN</pre>
              <p className="mt-1 text-xs text-text-tertiary">
                It previews what it found, asks you to confirm, then uploads. Items then appear in billing.
              </p>
            </li>
          </ol>
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </Page>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  const color =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-500" : "";
  return (
    <div className="px-3 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-text-tertiary">{label}</div>
    </div>
  );
}
