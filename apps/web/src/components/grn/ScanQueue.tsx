import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { FileText, Loader2, RefreshCw, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  downloadScanBase64,
  invokeExtract,
  runProcessScans,
  updateScan,
  vendorGuess,
  scanInvoiceNo,
  signedScanUrl,
  deleteScan,
  scanStatusLabel,
  scanStatusVariant,
  type InvoiceScanRow,
} from "@/lib/invoiceScans";

/**
 * The invoice-scan queue/history list (SALT-221), extracted so the unified Import
 * surface and its History tab share one implementation. Self-contained: it fetches
 * its own rows (scoped to `batchId` when given), auto-refreshes while anything is in
 * flight, shows per-file status, and runs the row actions — open file, Review & post
 * (navigate to the existing review screen), Retry, and Delete (which reverses a posted
 * GRN). `Process queued` runs the background worker and surfaces the result.
 */
export function ScanQueue({ batchId, reloadSignal }: { batchId?: string; reloadSignal?: number }) {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const [rows, setRows] = useState<InvoiceScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [procMsg, setProcMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    let q = supabase
      .from("invoice_scans")
      .select("id,storage_path,original_filename,mime,status,invoice_no,vendor_guess,error,purchase_id,created_at")
      .eq("org_id", orgId);
    if (batchId) q = q.eq("batch_id", batchId);
    q.order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (!active) return;
        // Table ships in migration 0049; if unapplied the select errors — show a hint.
        if (error) {
          setUnavailable(true);
          setLoading(false);
          return;
        }
        setRows((data as InvoiceScanRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, batchId, reloadKey, reloadSignal]);

  // Auto-refresh while anything is in flight, so background extraction is visible as it
  // happens (the worker updates rows server-side; without this the list looks frozen).
  const inFlight = rows.some((r) => r.status === "pending" || r.status === "processing");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => setReloadKey((k) => k + 1), 4000);
    return () => clearInterval(t);
  }, [inFlight]);

  async function openFile(r: InvoiceScanRow) {
    const url = await signedScanUrl(r.storage_path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function retry(r: InvoiceScanRow) {
    setRetrying(r.id);
    try {
      const dl = await downloadScanBase64(r.storage_path);
      if ("error" in dl) {
        await updateScan(r.id, { status: "failed", error: `retry: ${dl.error}` });
        setReloadKey((k) => k + 1);
        return;
      }
      const out = await invokeExtract(dl.base64, dl.mime);
      if (out.notConfigured || out.error || !out.json) {
        await updateScan(r.id, { status: "failed", error: out.notConfigured ? "ocr_not_configured" : (out.error ?? "no data") });
        setReloadKey((k) => k + 1);
        return;
      }
      await updateScan(r.id, { status: "extracted", extracted_json: out.json, invoice_no: scanInvoiceNo(out.json), vendor_guess: vendorGuess(out.json), error: null });
      setReloadKey((k) => k + 1);
    } finally {
      setRetrying(null);
    }
  }

  // Run the background worker now and report what it did. Awaits the call (unlike the
  // fire-and-forget kickoff at upload) so a stuck queue gets a real answer — it either
  // drains here, or surfaces why (e.g. the process-scans function isn't deployed).
  async function processNow() {
    setProcessing(true);
    setProcMsg(null);
    try {
      const res = await runProcessScans(batchId ?? null);
      if (!res.ok) {
        setProcMsg(`Could not run extraction: ${res.error}`);
      } else if ((res.total ?? 0) === 0) {
        setProcMsg("Worker ran but found nothing pending to extract.");
      } else {
        const parts = [`extracted ${res.extracted ?? 0}`];
        if (res.duplicate) parts.push(`${res.duplicate} duplicate`);
        if (res.failed) parts.push(`${res.failed} failed`);
        setProcMsg(`Processed ${res.total} — ${parts.join(", ")}.`);
      }
      setReloadKey((k) => k + 1);
    } finally {
      setProcessing(false);
    }
  }

  // Remove the scan + its file; for a posted scan, also reverse + delete its GRN.
  async function doDelete(r: InvoiceScanRow) {
    setDeleting(r.id);
    setDelErr(null);
    try {
      const { error } = await deleteScan(r.id, r.storage_path, r.purchase_id);
      if (error) {
        setDelErr(`Could not delete ${r.original_filename ?? "scan"}: ${error}`);
        return;
      }
      setRows((rs) => rs.filter((x) => x.id !== r.id));
    } finally {
      setDeleting(null);
      setConfirmId(null);
    }
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const extractingCount = rows.filter((r) => r.status === "processing").length;
  const extractedCount = rows.filter((r) => r.status === "extracted").length;
  const postedCount = rows.filter((r) => r.status === "posted").length;
  const dupCount = rows.filter((r) => r.status === "duplicate").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  if (unavailable) {
    return (
      <div className="rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning">
        Scan history isn't set up yet — run migration <code>0049_invoice_scans.sql</code> (creates the
        <code> invoice-scans</code> bucket + <code>invoice_scans</code> table). Importing still works without it.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Queued" value={pending} />
        <StatCard label="Extracting" value={extractingCount} />
        <StatCard label="Extracted" value={extractedCount} />
        <StatCard label="Posted" value={postedCount} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
          {extractingCount > 0 && <Loader2 className="size-3 animate-spin" />}
          {pending > 0 || extractingCount > 0
            ? extractingCount > 0
              ? "Extracting in the background — this list refreshes automatically."
              : "Queued invoices are waiting for the worker. The list auto-refreshes; if they do not move, click Process queued."
            : dupCount > 0 || failedCount > 0
              ? [dupCount > 0 ? `${dupCount} duplicate` : null, failedCount > 0 ? `${failedCount} failed` : null].filter(Boolean).join(" · ")
              : ""}
        </p>
        {pending > 0 && (
          <Button variant="outline" size="sm" onClick={processNow} disabled={processing}>
            {processing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {processing ? "Processing…" : `Process queued (${pending})`}
          </Button>
        )}
      </div>

      {procMsg && <p className="mb-3 text-sm text-text-secondary">{procMsg}</p>}

      <DataTable<InvoiceScanRow>
        rows={rows}
        rowKey={(r) => r.id}
        cols="1fr 1.4fr 1fr 0.9fr 1fr"
        loading={loading}
        empty={
          <EmptyState
            icon={ScanLine}
            title={batchId ? "Nothing in this batch yet" : "No scans yet"}
            hint={batchId ? "Drop invoices above to start." : "Import a vendor invoice to start the audit trail."}
          />
        }
        columns={[
          {
            key: "date",
            header: "Date",
            cell: (r) => <span className="text-text-tertiary">{format(new Date(r.created_at), "d MMM, HH:mm")}</span>,
          },
          {
            key: "file",
            header: "File",
            cell: (r) => (
              <button onClick={() => openFile(r)} className="inline-flex items-center gap-1 text-primary hover:underline">
                <FileText className="size-3.5" /> {r.original_filename ?? "invoice"}
              </button>
            ),
          },
          {
            key: "vendor",
            header: "Vendor",
            cell: (r) => (
              <span>
                {r.vendor_guess ?? <span className="text-text-tertiary">—</span>}
                {r.invoice_no && <span className="ml-1.5 text-xs text-text-tertiary">{r.invoice_no}</span>}
              </span>
            ),
          },
          { key: "status", header: "Status", cell: (r) => <Badge variant={scanStatusVariant(r.status)}>{scanStatusLabel(r.status)}</Badge> },
          {
            key: "action",
            header: "",
            cell: (r) => (
              <div className="flex items-center justify-end gap-3">
                {r.status === "failed" ? (
                  <Button size="sm" variant="outline" disabled={retrying === r.id} onClick={() => retry(r)}>
                    <RotateCcw /> {retrying === r.id ? "Retrying…" : "Retry"}
                  </Button>
                ) : r.purchase_id ? (
                  <Link to={`/purchases/${r.purchase_id}`} className="text-sm text-primary hover:underline">
                    View GRN →
                  </Link>
                ) : r.status === "extracted" || r.status === "duplicate" ? (
                  <button onClick={() => navigate(`/purchases/scan?scan=${r.id}`)} className="text-sm text-primary hover:underline">
                    Review &amp; post →
                  </button>
                ) : null}
                {confirmId === r.id ? (
                  <button
                    onClick={() => doDelete(r)}
                    disabled={deleting === r.id}
                    className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    {deleting === r.id ? "Deleting…" : r.purchase_id ? "Delete GRN + scan?" : "Confirm delete"}
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmId(r.id)}
                    className="text-text-tertiary hover:text-destructive"
                    aria-label="Delete scan"
                    title="Delete scan + file"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      {delErr && <p className="mt-3 text-sm text-destructive">{delErr}</p>}
    </div>
  );
}
