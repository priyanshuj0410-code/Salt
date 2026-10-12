import { useState, useEffect } from "react";
import { FileUp, Upload, Wand2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { parseFile } from "@/lib/smartParse";
import { autoMap, type Table } from "@/lib/smartImport";
import type { DocCtx } from "@/lib/smartDocument";
import {
  PAYMENT_CONFIG,
  preparePayments,
  type PaymentDirection,
  type PaymentPrepareResult,
} from "@/lib/smartPayment";
import { cn } from "@/lib/utils";
import { MapGroup } from "./MapGroup";

const CHUNK = 500;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

interface Result {
  imported: number;
  skippedDocs: number; // already imported (idempotency)
  skipped: number; // wholly-blank rows
  quarantined: PaymentPrepareResult["quarantined"];
}

export function PaymentStep({
  orgId,
  shopId,
  initialFile,
  onComplete,
}: {
  orgId: string | undefined;
  shopId: string | null | undefined;
  /** Pre-loaded by the drop-all router (SALT-153); auto-parsed on mount. */
  initialFile?: File | null;
  onComplete: () => void;
}) {
  const cfg = PAYMENT_CONFIG;
  const [phase, setPhase] = useState<"upload" | "map" | "result">("upload");
  const [parsed, setParsed] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [defaultDirection, setDefaultDirection] = useState<PaymentDirection>("received");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Auto-load a file routed in by the drop-all panel (state set only post-parse).
  useEffect(() => {
    if (!initialFile) return;
    let cancelled = false;
    parseFile(initialFile, cfg.fields)
      .then((p) => {
        if (cancelled) return;
        if (p.headers.length === 0) {
          setError("Could not read any columns from that file.");
          return;
        }
        setParsed(p);
        setMapping(autoMap(p.headers, cfg.fields));
        setPhase("map");
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read that file.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialFile, cfg]);

  async function onFile(file: File) {
    setError(null);
    const p = await parseFile(file, cfg.fields);
    if (p.headers.length === 0) {
      setError("Could not read any columns from that file.");
      return;
    }
    setParsed(p);
    setMapping(autoMap(p.headers, cfg.fields));
    setPhase("map");
  }

  async function runImport() {
    if (!parsed) return;
    if (!supabase || !orgId) {
      setError("Not connected to the database.");
      return;
    }
    if (!shopId) {
      setError("No active shop: set a primary shop before importing payments.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Party (ledger) resolution, paged past the 1000-row cap.
      const parties = await selectAll<{ id: string; name: string; gstin: string | null }>((f, t) =>
        supabase!.from("ledgers").select("id,name,gstin").eq("org_id", orgId).range(f, t),
      );
      const ctx: Pick<DocCtx, "partyByGstin" | "partyByName"> = {
        partyByGstin: new Map(parties.filter((v) => v.gstin).map((v) => [(v.gstin as string).toUpperCase(), v.id])),
        partyByName: new Map(parties.map((v) => [norm(v.name), v.id])),
      };

      // Idempotency: skip vouchers whose source_doc_no already imported.
      const existing = await selectAll<{ source_doc_no: string | null }>((f, t) =>
        supabase!
          .from(cfg.table)
          .select("source_doc_no")
          .eq("org_id", orgId)
          .eq("shop_id", shopId)
          .eq("source_system", "marg")
          .not("source_doc_no", "is", null)
          .range(f, t),
      );
      const existingSet = new Set(existing.map((e) => e.source_doc_no));

      const prep = preparePayments(parsed.rows, mapping, ctx, defaultDirection);
      const fresh = prep.valid.filter((p) => !existingSet.has(p.docNo));
      const skippedDocs = prep.valid.length - fresh.length;

      // Flat rows — no header/line linkage, so a plain chunked bulk insert.
      const payload = fresh.map((p) => ({ ...p.row, org_id: orgId, shop_id: shopId }));
      let imported = 0;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const { error: ierr } = await supabase.from(cfg.table).insert(slice);
        if (ierr) {
          setError(ierr.message);
          return;
        }
        imported += slice.length;
      }

      setResult({ imported, skippedDocs, skipped: prep.skipped, quarantined: prep.quarantined });
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  // ---- upload phase ----
  if (phase === "upload") {
    return (
      <div className="rounded-lg border p-5">
        <div className="mb-4">
          <p className="text-sm">{cfg.description}</p>
          <p className="mt-2 text-xs font-medium text-text-tertiary">Columns we look for:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {cfg.fields.map((f) => (
              <span key={f.key} className="rounded-md border bg-surface-2/40 px-2 py-0.5 text-xs">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-tertiary">{cfg.tip}</p>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-text-tertiary hover:bg-surface-2/40"
        >
          <FileUp className="size-6" />
          <span>
            Drop your <span className="font-medium text-foreground">{cfg.label.toLowerCase()}</span> file
            here, or click to choose
          </span>
          <span className="text-xs">CSV, XLS or XLSX</span>
          <input
            type="file"
            accept=".csv,.xls,.xlsx,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-3 text-center">
          <button onClick={onComplete} className="text-xs text-text-tertiary hover:text-foreground">
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ---- map phase ----
  if (phase === "map") {
    const voucherMapped = Boolean(mapping.voucher_no);
    const amountMapped = Boolean(mapping.amount || mapping.amount_received || mapping.amount_paid);
    const canImport = voucherMapped && amountMapped;
    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <Wand2 className="size-4 text-primary" />
          <span className="font-medium">Check the column mapping</span>
          <span className="text-text-tertiary">{parsed?.rows.length ?? 0} rows.</span>
        </div>

        <MapGroup
          title="Voucher"
          fields={cfg.fields}
          mapping={mapping}
          headers={parsed?.headers ?? []}
          onChange={setMapping}
        />

        <div className="mt-4">
          <p className="text-xs font-medium text-text-tertiary">Default direction</p>
          <p className="text-xs text-text-tertiary">
            Used when a row has no Type column and no separate received/paid amount.
          </p>
          <div className="mt-1.5 inline-flex rounded-md border p-0.5">
            {(["received", "paid"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDefaultDirection(d)}
                className={cn(
                  "rounded px-3 py-1 text-sm capitalize",
                  defaultDirection === d ? "bg-primary text-primary-foreground" : "text-text-tertiary",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {!voucherMapped && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-500">
            <AlertTriangle className="size-4 shrink-0" /> Map the voucher no: it is the dedup key for safe
            re-import.
          </p>
        )}
        {voucherMapped && !amountMapped && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-500">
            <AlertTriangle className="size-4 shrink-0" /> Map an amount: a single Amount, or separate
            received / paid columns.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={runImport} disabled={busy || !canImport}>
            <Upload />
            {busy ? "Importing…" : "Import payments"}
          </Button>
          <Button variant="ghost" onClick={() => setPhase("upload")} disabled={busy}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  // ---- result phase ----
  return (
    <div className="rounded-lg border p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium text-emerald-700 dark:text-emerald-400">
          {result?.imported ?? 0} payments imported
        </span>
        {(result?.skippedDocs ?? 0) > 0 && (
          <span className="text-text-tertiary">{result?.skippedDocs} already imported (skipped)</span>
        )}
        {(result?.quarantined.length ?? 0) > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-500">
            {result?.quarantined.length} skipped
          </span>
        )}
      </div>

      {(result?.quarantined.length ?? 0) > 0 && (
        <>
          <p className="mt-3 text-sm text-text-tertiary">
            These vouchers could not be imported (see reasons). If parties are missing, import your
            ledgers/party-GST first; then re-run: already-imported vouchers are skipped.
          </p>
          <div className="mt-2 max-h-48 overflow-auto rounded-md border bg-amber-500/5 p-2 text-xs">
            {result?.quarantined.slice(0, 50).map((q, i) => (
              <div key={`${q.docNo}-${i}`} className="flex justify-between gap-3 py-0.5">
                <span className="truncate">{q.docNo}</span>
                <span className="shrink-0 text-text-tertiary">{q.reason}</span>
              </div>
            ))}
            {(result?.quarantined.length ?? 0) > 50 && (
              <p className="pt-1 text-text-tertiary">+{(result?.quarantined.length ?? 0) - 50} more</p>
            )}
          </div>
        </>
      )}

      {(result?.skipped ?? 0) > 0 && (
        <p className="mt-2 text-xs text-text-tertiary">{result?.skipped} blank rows were skipped.</p>
      )}

      <div className="mt-4">
        <Button onClick={onComplete}>Continue to next step</Button>
      </div>
    </div>
  );
}
