import { useRef, useState } from "react";
import { FileUp, ArrowRight, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readMatrix } from "@/lib/smartParse";
import { classifyMatrix, CANDIDATES, type FileClassification } from "@/lib/fingerprint";

interface Row {
  id: number;
  file: File;
  cls: FileClassification;
  /** Chosen step key (the select value); "" = handle manually. */
  chosen: string;
}

const orderOf = (stepKey: string) => {
  const i = CANDIDATES.findIndex((c) => c.stepKey === stepKey);
  return i < 0 ? 999 : i;
};

/**
 * Drop-all auto-detect router (SALT-153). Drop every Marg export at once; each
 * file is fingerprinted (lib/fingerprint) and routed to the right importer.
 * Below-threshold files default to "manual". Routing pre-loads the file into its
 * step (onRoute) — no new load logic, the steps do the importing.
 */
export function DropAllPanel({ onRoute }: { onRoute: (stepKey: string, file: File) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  async function add(dropped: FileList | File[]) {
    setBusy(true);
    setError(null);
    try {
      const next: Row[] = [];
      for (const file of Array.from(dropped)) {
        const cls = classifyMatrix(await readMatrix(file));
        next.push({ id: seq.current++, file, cls, chosen: cls.best?.stepKey ?? "" });
      }
      setRows((prev) =>
        [...prev, ...next].sort((a, b) => orderOf(a.chosen || "zzz") - orderOf(b.chosen || "zzz")),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those files.");
    } finally {
      setBusy(false);
    }
  }

  function setChosen(id: number, chosen: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, chosen } : r)));
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3">
        <p className="text-sm font-medium">Drop everything</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Drop all your Marg exports at once — we detect what each file is and send it to the right step.
          Anything we are unsure about, you place yourself.
        </p>
      </div>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) add(e.dataTransfer.files);
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground hover:bg-muted/40"
      >
        <FileUp className="size-5" />
        <span>{busy ? "Detecting…" : "Drop multiple files here, or click to choose"}</span>
        <span className="text-xs">CSV, XLS or XLSX</span>
        <input
          type="file"
          accept=".csv,.xls,.xlsx,text/csv"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && add(e.target.files)}
        />
      </label>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const pct = r.cls.matches[0] ? Math.round(r.cls.matches[0].score * 100) : 0;
            const confident = Boolean(r.cls.best);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={r.file.name}>
                  {r.file.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-xs",
                    confident
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-500",
                  )}
                  title={confident ? "Detected" : "Low confidence — pick the right step or handle it in the stepper"}
                >
                  {confident ? `${pct}% match` : r.cls.matches[0] ? `${pct}% (unsure)` : "unknown"}
                </span>
                <select
                  value={r.chosen}
                  onChange={(e) => setChosen(r.id, e.target.value)}
                  className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
                >
                  <option value="">— handle manually —</option>
                  {CANDIDATES.map((c) => (
                    <option key={c.stepKey} value={c.stepKey}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {r.chosen ? (
                  <Button size="sm" onClick={() => onRoute(r.chosen, r.file)}>
                    Open <ArrowRight className="size-3.5" />
                  </Button>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <CircleHelp className="size-3.5" /> use a step
                  </span>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">
            Open each file in cascade order (top to bottom). Trial-balance &amp; party-GST files: pick the
            step, then drop the file there.
          </p>
        </div>
      )}
    </div>
  );
}
