import { useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileUp, KeyRound, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { UserMenu } from "@/components/auth/UserMenu";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import {
  templateCsv,
  validateRows,
  type RawRow,
  type ValidationResult,
} from "@/lib/import";

function downloadTemplate() {
  const blob = new Blob([templateCsv()], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "salt-catalog-template.csv";
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
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => setResult(validateRows(res.data)),
    });
  }

  async function doImport() {
    if (!supabase || !membership || !result) return;
    setImporting(true);
    setError(null);
    try {
      const orgId = membership.orgId;
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
          setError(bErr.message);
          return;
        }
      }

      await loadCatalog(orgId);
      setDone({ items: result.items.length, batches: batchPayload.length });
      setResult(null);
      setFileName(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Import data</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 p-6">
        <h1 className="text-xl font-semibold">Import your catalogue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a CSV of your items and stock. Only <code className="rounded bg-muted px-1">name</code>,{" "}
          <code className="rounded bg-muted px-1">qty</code> and <code className="rounded bg-muted px-1">mrp</code>{" "}
          are required — everything else is optional. One row per batch.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download />
            Download template
          </Button>
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
                    <span className="text-muted-foreground">Row {p.row}</span>
                    <span className={p.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-500"}>
                      {p.level === "error" ? "Error" : "Warning"}:
                    </span>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-3 border-t p-3">
              <p className="text-xs text-muted-foreground">
                {result.errorCount > 0
                  ? "Fix the errors in your CSV and re-upload."
                  : "Re-importing the same file adds rows again (no dedupe yet)."}
              </p>
              <Button onClick={doImport} disabled={importing || result.items.length === 0 || result.errorCount > 0}>
                <Upload />
                {importing ? "Importing…" : `Import ${result.items.length} items`}
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-lg border p-4">
          <h2 className="text-sm font-medium">Bring data from Marg (migrator)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Generate a one-time token and paste it into the Salt Migrator on your Marg PC. It is
            scoped to this org and expires in 24 hours.
          </p>
          <div className="mt-3">
            <Button variant="outline" onClick={generateToken} disabled={tokenBusy}>
              <KeyRound />
              {tokenBusy ? "Generating…" : "Generate upload token"}
            </Button>
          </div>
          {token && (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={token}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 flex-1 rounded-md border bg-muted px-2 font-mono text-xs"
                  aria-label="Migration token"
                />
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(token)}>
                  Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                One-time use · expires in 24h · treat it like a password.
              </p>
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  const color =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-500" : "";
  return (
    <div className="px-3 py-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
