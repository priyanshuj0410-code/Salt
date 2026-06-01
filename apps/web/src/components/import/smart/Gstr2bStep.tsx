import { useState } from "react";
import { FileUp, Upload, Wand2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { parseFile } from "@/lib/smartParse";
import { autoMap, toExpiryYM, type Table } from "@/lib/smartImport";
import { GSTR2B_FIELDS, prepareLines, reconcile, type PurchaseForMatch, type ReconSummary } from "@/lib/gstr2b";
import { MapGroup } from "./MapGroup";

const CHUNK = 500;
const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

/**
 * Imports a GSTR-2B B2B sheet (GST portal, not Marg) → gstr2b_imports +
 * gstr2b_lines, then reconciles against the purchase register → gstr2b_matches.
 * Idempotent per period: re-importing a period replaces it (cascade delete).
 */
export function Gstr2bStep({ orgId, onComplete }: { orgId: string | undefined; onComplete: () => void }) {
  const [phase, setPhase] = useState<"upload" | "map" | "result">("upload");
  const [parsed, setParsed] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [period, setPeriod] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(ReconSummary & { lines: number }) | null>(null);

  async function onFile(file: File) {
    setError(null);
    const p = await parseFile(file, GSTR2B_FIELDS);
    if (p.headers.length === 0) {
      setError("Could not read any columns from that file.");
      return;
    }
    setParsed(p);
    setMapping(autoMap(p.headers, GSTR2B_FIELDS));
    setFilename(file.name);
    setPhase("map");
  }

  async function runImport() {
    if (!parsed || !supabase || !orgId) {
      setError("Not connected to the database.");
      return;
    }
    const normPeriod = toExpiryYM(period);
    if (!normPeriod) {
      setError("Enter the return period as YYYY-MM (e.g. 2025-06).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const lines = prepareLines(parsed.rows, mapping);
      if (lines.length === 0) {
        setError("No usable invoice rows found — check the column mapping.");
        return;
      }
      const lineIds = lines.map(() => crypto.randomUUID());

      // Idempotent per period: drop any prior import for this period (cascade
      // removes its lines + matches), then re-create.
      await supabase.from("gstr2b_imports").delete().eq("org_id", orgId).eq("period", normPeriod);
      const importId = crypto.randomUUID();
      const { error: ierr } = await supabase
        .from("gstr2b_imports")
        .insert({ id: importId, org_id: orgId, period: normPeriod, filename });
      if (ierr) {
        setError(ierr.message);
        return;
      }
      const linePayload = lines.map((l, i) => ({ ...l, id: lineIds[i], org_id: orgId, import_id: importId }));
      for (let i = 0; i < linePayload.length; i += CHUNK) {
        const { error: lerr } = await supabase.from("gstr2b_lines").insert(linePayload.slice(i, i + CHUNK));
        if (lerr) {
          setError(lerr.message);
          return;
        }
      }

      // Reconcile against the purchase register (supplier GSTIN via the vendor ledger).
      const purchases = await selectAll<{
        id: string;
        vendor_id: string | null;
        vendor_invoice_no: string | null;
        cgst_paise: number;
        sgst_paise: number;
        igst_paise: number;
      }>((f, t) =>
        supabase!
          .from("purchases")
          .select("id,vendor_id,vendor_invoice_no,cgst_paise,sgst_paise,igst_paise")
          .eq("org_id", orgId)
          .range(f, t),
      );
      const ledgers = await selectAll<{ id: string; gstin: string | null }>((f, t) =>
        supabase!.from("ledgers").select("id,gstin").eq("org_id", orgId).range(f, t),
      );
      const gstinById = new Map(ledgers.map((l) => [l.id, l.gstin]));
      const forMatch: PurchaseForMatch[] = purchases.map((p) => ({
        id: p.id,
        vendor_gstin: p.vendor_id ? gstinById.get(p.vendor_id) ?? null : null,
        vendor_invoice_no: p.vendor_invoice_no,
        cgst_paise: p.cgst_paise,
        sgst_paise: p.sgst_paise,
        igst_paise: p.igst_paise,
      }));
      const recon = reconcile(lines, forMatch);

      const matchPayload = recon.matches.map((m) => ({
        org_id: orgId,
        gstr2b_line_id: lineIds[m.lineIndex],
        purchase_id: m.purchase_id,
        match_status: m.match_status,
        variance_paise: m.variance_paise,
      }));
      for (let i = 0; i < matchPayload.length; i += CHUNK) {
        const { error: merr } = await supabase.from("gstr2b_matches").insert(matchPayload.slice(i, i + CHUNK));
        if (merr) {
          setError(merr.message);
          return;
        }
      }

      setResult({ ...recon.summary, lines: lines.length });
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
          <p className="text-sm">
            Your <span className="font-medium">GSTR-2B</span> (from the GST portal — not Marg). We import the
            B2B invoices and reconcile them against your purchases to flag ITC gaps.
          </p>
          <p className="mt-2 text-xs font-medium text-text-tertiary">Columns we look for:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {GSTR2B_FIELDS.map((f) => (
              <span key={f.key} className="rounded-md border bg-surface-2/40 px-2 py-0.5 text-xs">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-tertiary">
            Export the B2B sheet of your GSTR-2B (Excel/CSV). Re-importing a period replaces it.
          </p>
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
          <span>Drop your GSTR-2B file here, or click to choose</span>
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
    const ready = Boolean(mapping.vendor_gstin && mapping.invoice_no && toExpiryYM(period));
    return (
      <div className="rounded-lg border p-5">
        <div className="flex items-center gap-2 text-sm">
          <Wand2 className="size-4 text-primary" />
          <span className="font-medium">Check the column mapping</span>
          <span className="text-text-tertiary">— {parsed?.rows.length ?? 0} rows.</span>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_1.5fr] items-center gap-3 text-sm">
          <span>
            Return period (YYYY-MM)<span className="ml-1 text-destructive">*</span>
          </span>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2025-06" className="h-8" />
        </div>

        <MapGroup
          title="GSTR-2B columns"
          fields={GSTR2B_FIELDS}
          mapping={mapping}
          headers={parsed?.headers ?? []}
          onChange={setMapping}
        />

        {!ready && (
          <p className="mt-3 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-500">
            <AlertTriangle className="size-4 shrink-0" /> Map supplier GSTIN + invoice no and set the period.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={runImport} disabled={busy || !ready}>
            <Upload />
            {busy ? "Importing…" : "Import & reconcile"}
          </Button>
          <Button variant="ghost" onClick={() => setPhase("upload")} disabled={busy}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  // ---- result phase ----
  const r = result;
  return (
    <div className="rounded-lg border p-5">
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        {r?.lines ?? 0} GSTR-2B invoices imported &amp; reconciled.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Matched" value={r?.matched ?? 0} tone="ok" />
        <Stat label="ITC mismatch" value={r?.mismatch ?? 0} tone={r && r.mismatch > 0 ? "warn" : "muted"} />
        <Stat label="Missing in books" value={r?.missingInBooks ?? 0} tone={r && r.missingInBooks > 0 ? "warn" : "muted"} />
        <Stat label="Missing in 2B" value={r?.missingIn2b ?? 0} tone={r && r.missingIn2b > 0 ? "warn" : "muted"} />
      </div>
      <p className="mt-3 text-sm text-text-tertiary">
        ITC in 2B: <span className="font-medium text-foreground">{inr(r?.itc2bPaise ?? 0)}</span> · reconciled
        to books: <span className="font-medium text-foreground">{inr(r?.itcMatchedPaise ?? 0)}</span>
      </p>
      <div className="mt-4">
        <Button onClick={onComplete}>Continue to next step</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "muted" }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div
        className={
          tone === "ok"
            ? "text-lg font-semibold text-emerald-700 dark:text-emerald-400"
            : tone === "warn"
              ? "text-lg font-semibold text-amber-600 dark:text-amber-500"
              : "text-lg font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}
