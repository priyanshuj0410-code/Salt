import { useState } from "react";
import { FileUp, Upload, Wand2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { parseFile } from "@/lib/smartParse";
import { autoMap, type Table } from "@/lib/smartImport";
import {
  groupDocuments,
  prepareDocuments,
  type DocCtx,
  type DocumentConfig,
  type PrepareResult,
} from "@/lib/smartDocument";
import { MapGroup } from "./MapGroup";

const CHUNK = 500;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();

interface Result {
  docs: number;
  lines: number;
  skippedDocs: number;
  skippedLines: number;
  quarantined: PrepareResult["quarantined"];
}

export function DocumentStep({
  cfg,
  orgId,
  shopId,
  onComplete,
}: {
  cfg: DocumentConfig;
  orgId: string | undefined;
  shopId: string | null | undefined;
  onComplete: () => void;
}) {
  const allFields = [...cfg.headerFields, ...cfg.lineFields];
  const [phase, setPhase] = useState<"upload" | "map" | "result">("upload");
  const [parsed, setParsed] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(file: File) {
    setError(null);
    const p = await parseFile(file, allFields);
    if (p.headers.length === 0) {
      setError("Could not read any columns from that file.");
      return;
    }
    setParsed(p);
    setMapping(autoMap(p.headers, allFields));
    setPhase("map");
  }

  async function runImport() {
    if (!parsed) return;
    if (!supabase || !orgId) {
      setError("Not connected to the database.");
      return;
    }
    if (!shopId) {
      setError("No active shop — set a primary shop before importing documents.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Resolution context (paged past the 1000-row cap). Parties (ledgers) cover
      // both the vendor on a purchase and the customer on a sale.
      const parties = await selectAll<{ id: string; name: string; gstin: string | null }>((f, t) =>
        supabase!.from("ledgers").select("id,name,gstin").eq("org_id", orgId).range(f, t),
      );
      const items = await selectAll<{ id: string; name: string; item_code: string | null }>((f, t) =>
        supabase!.from("items").select("id,name,item_code").eq("org_id", orgId).range(f, t),
      );
      const ctx: DocCtx = {
        partyByGstin: new Map(parties.filter((v) => v.gstin).map((v) => [(v.gstin as string).toUpperCase(), v.id])),
        partyByName: new Map(parties.map((v) => [norm(v.name), v.id])),
        itemByCode: new Map(items.filter((i) => i.item_code).map((i) => [i.item_code as string, i.id])),
        itemByName: new Map(items.map((i) => [norm(i.name), i.id])),
      };

      // Idempotency: skip documents whose source_doc_no already imported.
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

      const allGroups = groupDocuments(parsed.rows, mapping, cfg);
      const groups = allGroups.filter((g) => !existingSet.has(g.docNo));
      const skippedDocs = allGroups.length - groups.length;

      const prep = prepareDocuments(cfg, groups, ctx);

      let docs = 0;
      let lines = 0;
      for (const d of prep.valid) {
        const id = crypto.randomUUID();
        const { error: herr } = await supabase
          .from(cfg.table)
          .insert({ ...d.header, id, org_id: orgId, shop_id: shopId });
        if (herr) {
          setError(herr.message);
          return;
        }
        const payload = d.lines.map((l) => ({ ...l, org_id: orgId, [cfg.lineFk]: id }));
        for (let i = 0; i < payload.length; i += CHUNK) {
          const { error: lerr } = await supabase.from(cfg.lineTable).insert(payload.slice(i, i + CHUNK));
          if (lerr) {
            setError(lerr.message);
            return;
          }
        }
        docs++;
        lines += payload.length;
      }

      setResult({ docs, lines, skippedDocs, skippedLines: prep.skippedLines, quarantined: prep.quarantined });
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
          <p className="mt-2 text-xs font-medium text-muted-foreground">Columns we look for:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {allFields.map((f) => (
              <span key={f.key} className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One row per line — we group rows into documents by the bill number. Column names need not
            match; we auto-map them.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{cfg.tip}</p>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) onFile(file);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-muted/40"
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
          <button onClick={onComplete} className="text-xs text-muted-foreground hover:text-foreground">
            Skip this step
          </button>
        </div>
      </div>
    );
  }

  // ---- map phase ----
  if (phase === "map") {
    const docNoMapped = Boolean(mapping.doc_no);
    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <Wand2 className="size-4 text-primary" />
          <span className="font-medium">Check the column mapping</span>
          <span className="text-muted-foreground">— {parsed?.rows.length ?? 0} rows.</span>
        </div>

        <MapGroup
          title="Document (header)"
          fields={cfg.headerFields}
          mapping={mapping}
          headers={parsed?.headers ?? []}
          onChange={setMapping}
        />
        <MapGroup
          title="Line items"
          fields={cfg.lineFields}
          mapping={mapping}
          headers={parsed?.headers ?? []}
          onChange={setMapping}
        />

        {!docNoMapped && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-500">
            <AlertTriangle className="size-4 shrink-0" /> Map the bill / GRN no — it groups rows into
            documents.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={runImport} disabled={busy || !docNoMapped}>
            <Upload />
            {busy ? "Importing…" : "Import documents"}
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
          {result?.docs ?? 0} documents, {result?.lines ?? 0} lines imported
        </span>
        {(result?.skippedDocs ?? 0) > 0 && (
          <span className="text-muted-foreground">{result?.skippedDocs} already imported (skipped)</span>
        )}
        {(result?.quarantined.length ?? 0) > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-500">
            {result?.quarantined.length} skipped
          </span>
        )}
      </div>

      {(result?.quarantined.length ?? 0) > 0 && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {cfg.kind === "purchase" || cfg.kind === "debit_note"
              ? "These documents could not be matched to a vendor — import your ledgers/party-GST first, then re-run this step (already-imported documents are skipped)."
              : "These documents could not be imported (see reasons). Fix the source data and re-run — already-imported documents are skipped."}
          </p>
          <div className="mt-2 max-h-48 overflow-auto rounded-md border bg-amber-500/5 p-2 text-xs">
            {result?.quarantined.slice(0, 50).map((q) => (
              <div key={q.docNo} className="flex justify-between gap-3 py-0.5">
                <span className="truncate">{q.docNo}</span>
                <span className="shrink-0 text-muted-foreground">{q.reason}</span>
              </div>
            ))}
            {(result?.quarantined.length ?? 0) > 50 && (
              <p className="pt-1 text-muted-foreground">+{(result?.quarantined.length ?? 0) - 50} more</p>
            )}
          </div>
        </>
      )}

      {(result?.skippedLines ?? 0) > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {result?.skippedLines} blank/unnamed lines were skipped.
        </p>
      )}

      <div className="mt-4">
        <Button onClick={onComplete}>Continue to next step</Button>
      </div>
    </div>
  );
}
