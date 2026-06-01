import { useState } from "react";
import { FileUp, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { parseFile } from "@/lib/smartParse";
import {
  autoMap,
  partitionRows,
  revalidate,
  type EntityConfig,
  type RowResult,
  type Table,
  type ValidateCtx,
} from "@/lib/smartImport";

const CHUNK = 500;

export function EntityStep({
  entity,
  orgId,
  shopId,
  onComplete,
}: {
  entity: EntityConfig;
  orgId: string | undefined;
  shopId?: string | null;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"upload" | "map" | "result">("upload");
  const [parsed, setParsed] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [ctx, setCtx] = useState<ValidateCtx>({});
  const [importedCount, setImportedCount] = useState(0);
  const [quarantine, setQuarantine] = useState<RowResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkField, setBulkField] = useState(entity.fields[0].key);
  const [bulkValue, setBulkValue] = useState("");

  async function onFile(file: File) {
    setError(null);
    const p = await parseFile(file, entity.fields);
    if (p.headers.length === 0) {
      setError("Could not read any columns from that file.");
      return;
    }
    setParsed(p);
    setMapping(autoMap(p.headers, entity.fields));
    setPhase("map");
  }

  async function buildCtx(): Promise<ValidateCtx> {
    if (entity.key !== "batches" || !supabase || !orgId) return {};
    // Page past PostgREST's 1000-row cap — otherwise large catalogues only
    // resolve their first 1000 items and every later stock row quarantines.
    const rows = await selectAll<{ id: string; name: string; item_code: string | null }>((from, to) =>
      supabase!.from("items").select("id,name,item_code").eq("org_id", orgId).range(from, to),
    );
    return {
      itemByName: new Map(rows.map((r) => [r.name.toLowerCase(), r.id])),
      itemNames: rows.map((r) => r.name),
      itemByCode: new Map(rows.filter((r) => r.item_code).map((r) => [r.item_code as string, r.id])),
    };
  }

  async function insertPayloads(payloads: Record<string, unknown>[]): Promise<string | null> {
    if (!supabase || !orgId || payloads.length === 0) return null;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const chunk: Record<string, unknown>[] = payloads
        .slice(i, i + CHUNK)
        .map((p) => ({ ...p, org_id: orgId, ...(entity.shopScoped ? { shop_id: shopId } : {}) }));
      if (entity.key === "items") {
        // Rows with a product code upsert (idempotent re-import); the rest insert.
        const withCode = chunk.filter((p) => p.item_code);
        const withoutCode = chunk.filter((p) => !p.item_code);
        if (withCode.length) {
          const { error: e1 } = await supabase
            .from("items")
            .upsert(withCode, { onConflict: "org_id,item_code" });
          if (e1) return e1.message;
        }
        if (withoutCode.length) {
          const { error: e2 } = await supabase.from("items").insert(withoutCode);
          if (e2) return e2.message;
        }
      } else if (entity.upsertOn) {
        // Keyed records (invoice series, filed returns) upsert for idempotent re-import.
        const { error: err } = await supabase.from(entity.key).upsert(chunk, { onConflict: entity.upsertOn });
        if (err) return err.message;
      } else {
        const { error: err } = await supabase.from(entity.key).insert(chunk);
        if (err) return err.message;
      }
    }
    return null;
  }

  async function runImport() {
    if (!parsed) return;
    if (entity.shopScoped && !shopId) {
      setError("No active shop — set a primary shop before importing this register.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await buildCtx();
      setCtx(c);
      const part = partitionRows(entity.key, parsed.rows, mapping, c);
      const err = await insertPayloads(part.valid.map((r) => r.payload!));
      if (err) {
        setError(err);
        return;
      }
      setImportedCount(part.valid.length);
      setQuarantine(part.quarantined);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function reprocess() {
    setBusy(true);
    setError(null);
    try {
      const stillBad: RowResult[] = [];
      const toInsert: Record<string, unknown>[] = [];
      for (const r of quarantine) {
        const res = revalidate(entity.key, r.data, ctx);
        if (res.payload) toInsert.push(res.payload);
        else stillBad.push(res);
      }
      const err = await insertPayloads(toInsert);
      if (err) {
        setError(err);
        return;
      }
      setImportedCount((c) => c + toInsert.length);
      setQuarantine(stillBad);
    } finally {
      setBusy(false);
    }
  }

  // ---- upload phase ----
  if (phase === "upload") {
    return (
      <div className="rounded-lg border p-5">
        <div className="mb-4">
          <p className="text-sm">{entity.description}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">Columns we look for:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {entity.fields.map((f) => (
              <span key={f.key} className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="text-destructive">*</span> required · others optional · column names
            need not match — we auto-map them.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{entity.tip}</p>
        </div>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground hover:bg-muted/40"
        >
          <FileUp className="size-6" />
          <span>
            Drop your <span className="font-medium text-foreground">{entity.label.toLowerCase()}</span> file
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
    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <Wand2 className="size-4 text-primary" />
          <span className="font-medium">Check the column mapping</span>
          <span className="text-muted-foreground">
            — {parsed?.rows.length ?? 0} rows. We pre-matched columns; adjust any that are off.
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {entity.fields.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr_1.5fr] items-center gap-3 text-sm">
              <span>
                {f.label}
                {f.required && <span className="ml-1 text-destructive">*</span>}
              </span>
              <select
                value={mapping[f.key] ?? ""}
                onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <option value="">— not mapped —</option>
                {parsed?.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={runImport} disabled={busy}>
            <Upload />
            {busy ? "Importing…" : `Import ${parsed?.rows.length ?? 0} rows`}
          </Button>
          <Button variant="ghost" onClick={() => setPhase("upload")}>
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
          {importedCount} imported
        </span>
        {quarantine.length > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-500">
            {quarantine.length} need a fix
          </span>
        )}
      </div>

      {quarantine.length > 0 ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Fix the highlighted cells (or apply a default to all), then re-process. Valid rows are
            already saved.
          </p>

          {/* Bulk apply-default */}
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <span className="text-xs text-muted-foreground">Set all</span>
            <select
              value={bulkField}
              onChange={(e) => setBulkField(e.target.value)}
              className="h-7 rounded-md border border-input bg-background px-2 text-sm outline-none"
            >
              {entity.fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              value={bulkValue}
              onChange={(e) => setBulkValue(e.target.value)}
              className="h-7 w-32"
              placeholder="value"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setQuarantine((qs) => qs.map((r) => ({ ...r, data: { ...r.data, [bulkField]: bulkValue } })))
              }
            >
              Apply
            </Button>
          </div>

          {/* Quarantine grid */}
          <div className="mt-3 max-h-80 overflow-auto rounded-md border">
            {quarantine.map((row, i) => {
              const errFields = new Set(row.issues.filter((x) => x.level === "error").map((x) => x.field));
              return (
                <div key={i} className="border-b p-2 last:border-b-0">
                  <div className="flex flex-wrap gap-2">
                    {entity.fields.map((f) => (
                      <label key={f.key} className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground">{f.label}</span>
                        <input
                          value={row.data[f.key] ?? ""}
                          onChange={(e) =>
                            setQuarantine((qs) =>
                              qs.map((r, idx) =>
                                idx === i ? { ...r, data: { ...r.data, [f.key]: e.target.value } } : r,
                              ),
                            )
                          }
                          className={cn(
                            "h-7 w-28 rounded-md border bg-background px-2 text-sm outline-none",
                            errFields.has(f.key) ? "border-destructive" : "border-input",
                          )}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-destructive">
                    {row.issues.filter((x) => x.level === "error").map((x) => x.message).join(" · ")}
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={reprocess} disabled={busy}>
              {busy ? "Re-processing…" : "Re-process fixed rows"}
            </Button>
            <Button variant="ghost" onClick={onComplete}>
              Continue (skip remaining {quarantine.length})
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <Button onClick={onComplete}>Continue to next step</Button>
        </div>
      )}
    </div>
  );
}
