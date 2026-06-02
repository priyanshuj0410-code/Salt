import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { FileText, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  downloadScanBase64,
  invokeExtract,
  updateScan,
  vendorGuess,
  scanInvoiceNo,
  signedScanUrl,
  deleteScan,
  scanStatusLabel,
  scanStatusVariant,
  type InvoiceScanRow,
} from "@/lib/invoiceScans";
import { ocrInvoiceToRows } from "@/lib/ocrInvoice";
import { parsePurchaseInvoices } from "@/lib/importPurchaseInvoice";

/**
 * Scan history (SALT-221): the audit trail of every OCR'd invoice. Each row links
 * to the stored file (signed URL) and the posted GRN. A failed scan can be retried
 * from the stored file — re-running extraction without a re-upload. A retry that
 * extracts cleanly routes to /purchases/scan to review + post.
 */
export function InvoiceScansPage() {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const [rows, setRows] = useState<InvoiceScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Delete needs a deliberate second click (no native confirm in the design system).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("invoice_scans")
      .select("id,storage_path,original_filename,mime,status,invoice_no,vendor_guess,error,purchase_id,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
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
  }, [orgId, reloadKey]);

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
      // Sanity: make sure it actually parses to at least one invoice before sending
      // the user to review; if not, leave it extracted with a note.
      const parsed = parsePurchaseInvoices(ocrInvoiceToRows(out.json).rows);
      if (parsed.invoices.length === 0) {
        setReloadKey((k) => k + 1);
        return;
      }
      // The scan screen re-extracts on its own upload; for a retry we just refresh
      // the row to "extracted" — the user re-opens the scan flow to post. Keep it simple.
      setReloadKey((k) => k + 1);
    } finally {
      setRetrying(null);
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

  if (unavailable) {
    return (
      <Page width="lg">
        <PageHeader icon={ScanLine} title="Scan history" subtitle="Audit trail of OCR-scanned invoices." />
        <div className="rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning">
          Scan history isn't set up yet — run migration <code>0049_invoice_scans.sql</code> (creates the
          <code> invoice-scans</code> bucket + <code>invoice_scans</code> table). Scanning still works without it.
        </div>
      </Page>
    );
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={ScanLine}
        title="Scan history"
        subtitle={rows.length > 0 ? `${rows.length} scanned invoices` : "Audit trail of OCR-scanned invoices"}
        actions={
          <Button onClick={() => navigate("/purchases/scan")}>
            <ScanLine /> Scan invoice
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Scans" value={rows.length} />
        <StatCard label="Posted" value={rows.filter((r) => r.status === "posted").length} />
        <StatCard label="Extracted" value={rows.filter((r) => r.status === "extracted").length} />
        <StatCard label="Failed" value={rows.filter((r) => r.status === "failed").length} />
      </div>

      <DataTable<InvoiceScanRow>
        rows={rows}
        rowKey={(r) => r.id}
        cols="1fr 1.4fr 1fr 0.9fr 1fr"
        loading={loading}
        empty={<EmptyState icon={ScanLine} title="No scans yet" hint="Scan a vendor invoice to start the audit trail." />}
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
                  <Link to={`/purchases/scan?scan=${r.id}`} className="text-sm text-primary hover:underline">
                    Review &amp; post →
                  </Link>
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

      {rows.some((r) => r.status === "failed" && r.error) && (
        <div className="mt-4 space-y-1 text-xs text-text-tertiary">
          {rows
            .filter((r) => r.status === "failed" && r.error)
            .slice(0, 5)
            .map((r) => (
              <p key={r.id}>
                <span className="text-destructive">{r.original_filename ?? "invoice"}:</span> {r.error}
              </p>
            ))}
        </div>
      )}

      {delErr && <p className="mt-3 text-sm text-destructive">{delErr}</p>}
    </Page>
  );
}
