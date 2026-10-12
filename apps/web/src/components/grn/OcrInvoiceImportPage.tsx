import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileText, Loader2, ScanLine, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { formatPaise } from "@/lib/currency";
import { grnTotals } from "@/lib/grn";
import { buildReceivePurchasePayload, type PurchaseLine } from "@/lib/orders";
import { parseGstin } from "@/lib/gstin";
import { ocrInvoiceToRows, rowsToOcrInvoices } from "@/lib/ocrInvoice";
import {
  canonicalPurchaseHeader,
  parsePurchaseInvoices,
  purchaseTemplateCsv,
  type ParsedPurchaseInvoice,
  type PurchaseImportResult,
  type PurchaseRawRow,
} from "@/lib/importPurchaseInvoice";
import {
  createScan,
  getScanJson,
  insertExtractedScan,
  invokeExtract,
  kickoffProcessScans,
  updateScan,
  uploadScanFile,
} from "@/lib/invoiceScans";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";
import { findExistingInvoice } from "@/lib/purchaseDedup";
import { Dropzone } from "@/components/grn/Dropzone";
import { ScanQueue } from "@/components/grn/ScanQueue";

interface VendorRow { id: string; name: string; gstin: string | null }
interface ItemRow { id: string; name: string; item_code: string | null; barcode: string | null }
interface PostResult { invoiceNo: string; ok: boolean; error?: string }

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("could not read file"));
    r.readAsDataURL(file);
  });

const isCsv = (f: File) => /csv/i.test(f.type) || f.name.toLowerCase().endsWith(".csv");

/** Parse one CSV file to canonical rows: deterministic first (instant + free), then AI
 *  normalisation if the columns aren't recognised. */
async function parseCsvFileToRows(file: File): Promise<{ rows: PurchaseRawRow[]; usedAi: boolean }> {
  const text = await file.text();
  const parsed = Papa.parse<PurchaseRawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: canonicalPurchaseHeader,
  });
  if (parsePurchaseInvoices(parsed.data).invoices.some((i) => i.valid)) {
    return { rows: parsed.data, usedAi: false };
  }
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const out = await invokeExtract(btoa(bin), "text/csv");
  if (out.json) return { rows: ocrInvoiceToRows(out.json).rows, usedAi: true };
  return { rows: [], usedAi: false };
}

/** Parse + persist one CSV file into the queue: upload it once, then write one
 *  `extracted` (or `duplicate`) scan row per invoice it contains. CSV is parsed
 *  client-side, so its rows land ready immediately — no background worker needed. */
async function persistCsvFile(
  orgId: string,
  shopId: string | null,
  file: File,
  batchId: string,
): Promise<{ rowCount: number; written: number; dupes: number; usedAi: boolean; error?: string }> {
  const { rows, usedAi } = await parseCsvFileToRows(file);
  let written = 0;
  let dupes = 0;
  if (rows.length === 0) return { rowCount: 0, written, dupes, usedAi };
  const jsons = rowsToOcrInvoices(rows);
  if (jsons.length === 0) return { rowCount: rows.length, written, dupes, usedAi };
  const invoices = parsePurchaseInvoices(rows).invoices;
  const b64 = await readAsBase64(file);
  const up = await uploadScanFile(orgId, file, b64);
  if (up.error) return { rowCount: rows.length, written, dupes, usedAi, error: up.error };
  const fileMeta = { path: up.path, filename: file.name, mime: file.type || null };
  for (const { key, json } of jsons) {
    const inv = invoices.find((i) => i.key === key);
    if (!inv || !inv.valid) continue; // only postable invoices enter the queue
    const ex = await findExistingInvoice(orgId, inv.invoiceNo, inv.vendorName);
    const created = await insertExtractedScan(orgId, shopId, fileMeta, json, ex?.ref, batchId);
    if (created.id && !created.error) {
      written += 1;
      if (ex) dupes += 1;
    }
  }
  return { rowCount: rows.length, written, dupes, usedAi };
}

type UploadStatus = "uploading" | "queued" | "duplicate" | "failed";
interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  detail?: string;
}

function downloadTemplate() {
  const blob = new Blob([purchaseTemplateCsv()], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "salt-purchase-invoice-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

async function loadMasters(orgId: string) {
  const sb = supabase;
  if (!sb) return { vendors: [] as VendorRow[], items: [] as ItemRow[] };
  // Supabase caps a single SELECT at 1000 rows, so a migrated catalogue (thousands of
  // SKUs) came back partial — resolve*() then missed existing rows, which caused both
  // duplicate-key inserts AND "an item could not be resolved" on post. Page through with
  // .range() (1000-row pages) to load the FULL set; `.limit()` can't beat the server cap.
  async function all<T>(table: string, cols: string): Promise<T[]> {
    const PAGE = 1000;
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb!.from(table).select(cols).eq("org_id", orgId).range(from, from + PAGE - 1);
      const page = (data as T[] | null) ?? [];
      rows.push(...page);
      if (error || page.length < PAGE) break;
    }
    return rows;
  }
  const [vendors, items] = await Promise.all([
    all<VendorRow>("ledgers", "id,name,gstin"),
    all<ItemRow>("items", "id,name,item_code,barcode"),
  ]);
  return { vendors, items };
}

/**
 * The Import surface (`/purchases/scan`). Drop PDFs, photos, or CSVs → each becomes one
 * `invoice_scans` row (the queue), status-tracked in the list below and reviewed/posted
 * from there. Every file routes the same way (uniform): CSVs are parsed client-side and
 * land `extracted`; PDFs/images go `pending` for the background worker. "This upload"
 * shows the current batch; "History" shows everything.
 */
function ImportSurface() {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const [tab, setTab] = useState<"batch" | "history">("history");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [reloadSignal, setReloadSignal] = useState(0);

  // Per-file ingest: each dropped file gets its own live row (uploading → queued /
  // duplicate / failed-with-reason) so nothing is silently dropped. Successfully-queued
  // files then track their extraction status in the "This upload" queue below.
  async function ingest(files: File[]) {
    if (!supabase || !orgId || files.length === 0) return;
    const newBatch = crypto.randomUUID();
    setUploads(files.map((f) => ({ id: crypto.randomUUID(), name: f.name, status: "uploading" as UploadStatus })));
    setBusy(true);
    const patch = (i: number, p: Partial<UploadItem>) =>
      setUploads((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
    try {
      let queued = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          if (isCsv(file)) {
            const r = await persistCsvFile(orgId, shopId ?? null, file, newBatch);
            if (r.error) {
              patch(i, { status: "failed", detail: r.error });
            } else if (r.written === 0) {
              patch(i, { status: "failed", detail: r.rowCount === 0 ? "couldn't read this CSV" : "no postable invoices" });
            } else {
              queued += r.written;
              const bits = [`${r.written} invoice${r.written === 1 ? "" : "s"}`];
              if (r.dupes) bits.push(`${r.dupes} duplicate`);
              if (r.usedAi) bits.push("AI-normalised");
              patch(i, { status: r.dupes === r.written ? "duplicate" : "queued", detail: bits.join(" · ") });
            }
          } else {
            const b64 = await readAsBase64(file);
            const created = await createScan(orgId, shopId ?? null, file, b64, newBatch);
            if (created.error) patch(i, { status: "failed", detail: created.error });
            else {
              queued += 1;
              patch(i, { status: "queued", detail: "queued for extraction" });
            }
          }
        } catch (e) {
          patch(i, { status: "failed", detail: e instanceof Error ? e.message : "upload failed" });
        }
      }
      if (queued > 0) {
        await kickoffProcessScans(newBatch);
        setBatchId(newBatch);
        setTab("batch");
        setReloadSignal((s) => s + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="lg">
      <Link to="/purchases" className="mb-2 inline-block text-sm text-text-tertiary hover:text-text-primary">
        ← Purchases
      </Link>
      <PageHeader
        icon={ScanLine}
        title="Import invoices"
        subtitle="Drop vendor bills: PDF, photo, or CSV. Each lands as a GRN (stock, payable, ITC); missing vendors and items are created. Review & post each from the list. Files keep extracting if you leave."
        actions={
          <Button variant="outline" onClick={downloadTemplate}>
            <Download /> CSV template
          </Button>
        }
      />

      <Dropzone onFiles={ingest} busy={busy} busyLabel="Uploading…" />

      {uploads.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2 text-xs">
            <span className="font-medium text-text-secondary">Upload</span>
            <span className="text-text-tertiary">
              {uploads.filter((u) => u.status !== "uploading").length}/{uploads.length} done
            </span>
          </div>
          <ul className="max-h-72 divide-y divide-divider overflow-auto">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-text-tertiary" />
                  <span className="truncate">{u.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {u.detail && <span className="text-text-tertiary">{u.detail}</span>}
                  {u.status === "uploading" ? (
                    <span className="inline-flex items-center gap-1 text-text-tertiary">
                      <Loader2 className="size-3 animate-spin" /> Uploading…
                    </span>
                  ) : (
                    <Badge variant={u.status === "queued" ? "info" : u.status === "duplicate" ? "warning" : "danger"}>
                      {u.status === "queued" ? "Queued" : u.status === "duplicate" ? "Duplicate" : "Failed"}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-7">
        <div className="mb-4 flex items-center gap-1 border-b border-border text-sm">
          <button
            onClick={() => setTab("batch")}
            disabled={!batchId}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-medium transition-colors disabled:opacity-40",
              tab === "batch" ? "border-primary text-text-primary" : "border-transparent text-text-tertiary hover:text-text-primary",
            )}
          >
            This upload
          </button>
          <button
            onClick={() => setTab("history")}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-medium transition-colors",
              tab === "history" ? "border-primary text-text-primary" : "border-transparent text-text-tertiary hover:text-text-primary",
            )}
          >
            History
          </button>
        </div>

        {tab === "batch" && batchId ? (
          <ScanQueue batchId={batchId} reloadSignal={reloadSignal} />
        ) : (
          <ScanQueue reloadSignal={reloadSignal} />
        )}
      </div>
    </Page>
  );
}

/**
 * Review & post one extracted scan (`/purchases/scan?scan=<id>`), reached from the queue.
 * Loads the stored extraction — no re-OCR — into the dry-run review, flags duplicates,
 * and posts through `receive_purchase` (auto-creating missing vendors/items), then marks
 * the scan posted + linked to its GRN.
 */
function ScanReview({ scanId }: { scanId: string }) {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const blockers = useShopBlockers();
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [dupes, setDupes] = useState<Map<string, string>>(new Map());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ posted: number; failed: number; results: PostResult[] } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    (async () => {
      const json = await getScanJson(orgId, scanId);
      if (!active) return;
      if (!json) {
        setNotFound(true);
        return;
      }
      const mapped = ocrInvoiceToRows(json);
      const parsed = parsePurchaseInvoices(mapped.rows);
      const dup = new Map<string, string>();
      for (const inv of parsed.invoices) {
        if (!inv.invoiceNo) continue;
        const ex = await findExistingInvoice(orgId, inv.invoiceNo, inv.vendorName, { excludeIds: [scanId] });
        if (ex) dup.set(inv.key, ex.ref);
      }
      if (!active) return;
      setIssues(mapped.issues);
      setDupes(dup);
      setResult(parsed);
    })();
    return () => {
      active = false;
    };
  }, [orgId, scanId]);

  async function doImport() {
    if (!supabase || !orgId || !result) return;
    if (!blockers.ready || !shopId) {
      setError(null);
      setSetupOpen(true);
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const valid = result.invoices.filter((i) => i.valid && i.lines.length > 0 && !dupes.has(i.key));
      if (!valid.length) {
        setError("No valid invoice to import, fix the flagged fields, or it was a duplicate.");
        return;
      }
      const masters = await loadMasters(orgId);
      const vMap = new Map<string, string>();
      for (const v of masters.vendors) {
        if (v.gstin) vMap.set(`gst:${v.gstin.toUpperCase()}`, v.id);
        vMap.set(`name:${v.name.toLowerCase()}`, v.id);
      }
      const iMap = new Map<string, string>();
      for (const it of masters.items) {
        if (it.item_code) iMap.set(`code:${it.item_code.toLowerCase()}`, it.id);
        if (it.barcode) iMap.set(`bar:${it.barcode.toLowerCase()}`, it.id);
        iMap.set(`name:${it.name.toLowerCase()}`, it.id);
      }
      const resolveVendor = (inv: ParsedPurchaseInvoice) =>
        (inv.vendorGstin && vMap.get(`gst:${inv.vendorGstin.toUpperCase()}`)) ||
        vMap.get(`name:${inv.vendorName.toLowerCase()}`) ||
        null;
      const resolveItem = (l: { itemCode: string; barcode: string; name: string }) =>
        (l.itemCode && iMap.get(`code:${l.itemCode.toLowerCase()}`)) ||
        (l.barcode && iMap.get(`bar:${l.barcode.toLowerCase()}`)) ||
        iMap.get(`name:${l.name.toLowerCase()}`) ||
        null;

      const newVendors = new Map<string, { name: string; gstin: string }>();
      for (const inv of valid) {
        if (!resolveVendor(inv)) {
          const k = inv.vendorGstin ? `gst:${inv.vendorGstin.toUpperCase()}` : `name:${inv.vendorName.toLowerCase()}`;
          if (!newVendors.has(k)) newVendors.set(k, { name: inv.vendorName, gstin: inv.vendorGstin });
        }
      }
      if (newVendors.size) {
        const payload = [...newVendors.values()].map((v) => ({
          org_id: orgId, name: v.name, type: "vendor", gstin: v.gstin || null,
          state_code: v.gstin ? parseGstin(v.gstin).stateCode : null,
        }));
        const { data, error: e } = await supabase.from("ledgers").insert(payload).select("id,name,gstin");
        if (e) { setError(`Could not create vendors: ${e.message}`); return; }
        for (const row of (data as VendorRow[]) ?? []) {
          if (row.gstin) vMap.set(`gst:${row.gstin.toUpperCase()}`, row.id);
          vMap.set(`name:${row.name.toLowerCase()}`, row.id);
        }
      }
      const newItems = new Map<string, { code: string; barcode: string; name: string; hsn: string; gst: number }>();
      for (const inv of valid) {
        for (const l of inv.lines) {
          if (!resolveItem(l)) {
            const k = l.itemCode ? `code:${l.itemCode.toLowerCase()}` : l.barcode ? `bar:${l.barcode.toLowerCase()}` : `name:${l.name.toLowerCase()}`;
            if (!newItems.has(k)) newItems.set(k, { code: l.itemCode, barcode: l.barcode, name: l.name, hsn: l.hsn, gst: l.gstRate });
          }
        }
      }
      if (newItems.size) {
        const payload = [...newItems.values()].map((it) => ({
          org_id: orgId, name: it.name, item_code: it.code || null, barcode: it.barcode || null,
          hsn: it.hsn || null, gst_rate: it.gst, schedule: "OTC",
        }));
        // Upsert (not insert) on the (org_id, item_code) unique index: a code that already
        // exists — created earlier, by the migrator, or by a concurrent post — is skipped,
        // not errored. ignoreDuplicates ⇒ ON CONFLICT DO NOTHING.
        const { error: e } = await supabase
          .from("items")
          .upsert(payload, { onConflict: "org_id,item_code", ignoreDuplicates: true });
        if (e) { setError(`Could not create items: ${e.message}`); return; }
        // Rebuild the map from a fresh read — do NOT trust the upsert's RETURNING: with
        // ignoreDuplicates it omits the skipped (already-existing) rows and is unreliable
        // even for inserted ones, which left new items unmapped → the post failed "could
        // not resolve". A re-load has the id for every item this invoice needs.
        const fresh = await loadMasters(orgId);
        for (const it of fresh.items) {
          if (it.item_code) iMap.set(`code:${it.item_code.toLowerCase()}`, it.id);
          if (it.barcode) iMap.set(`bar:${it.barcode.toLowerCase()}`, it.id);
          iMap.set(`name:${it.name.toLowerCase()}`, it.id);
        }
      }

      const payment = { method: "credit" as const, creditDays: 0 };
      const results: PostResult[] = [];
      for (const inv of valid) {
        const vendorId = resolveVendor(inv);
        if (!vendorId) { results.push({ invoiceNo: inv.invoiceNo, ok: false, error: "vendor unresolved" }); continue; }
        const plines: PurchaseLine[] = [];
        let unresolved = false;
        for (const l of inv.lines) {
          const itemId = resolveItem(l);
          if (!itemId) { unresolved = true; break; }
          plines.push({
            itemId, name: l.name, batchNo: l.batchNo, expiry: l.expiry, qty: l.qty, freeQty: l.freeQty,
            ptrPaise: l.ptrPaise, printedPtrPaise: l.printedPtrPaise, ptsPaise: l.ptsPaise, costBasis: l.costBasis, mrpPaise: l.mrpPaise, gstRate: l.gstRate,
            discountType: l.discountType ?? undefined, discountValue: l.discountValue, schemeText: l.schemeText,
          });
        }
        if (unresolved) { results.push({ invoiceNo: inv.invoiceNo, ok: false, error: "an item could not be resolved" }); continue; }
        const args = buildReceivePurchasePayload(
          shopId, { id: vendorId, name: inv.vendorName }, plines, payment, false,
          { vendorInvoiceNo: inv.invoiceNo, vendorInvoiceDate: inv.date ?? undefined },
        );
        const { data: grnId, error: e } = await supabase.rpc("receive_purchase", args);
        results.push({ invoiceNo: inv.invoiceNo, ok: !e, error: e?.message });
        if (!e && typeof grnId === "string") {
          await updateScan(scanId, { status: "posted", purchase_id: grnId });
        }
      }

      await loadCatalog(orgId);
      const posted = results.filter((r) => r.ok).length;
      setReport({ posted, failed: results.length - posted, results });
      if (results.every((r) => r.ok)) setResult(null);
    } finally {
      setImporting(false);
    }
  }

  const postable = result ? result.invoices.filter((i) => i.valid && !dupes.has(i.key)).length : 0;

  return (
    <Page width="md">
      <Link to="/purchases/scan" className="mb-2 inline-block text-sm text-text-tertiary hover:text-text-primary">
        ← Import
      </Link>
      <PageHeader icon={ScanLine} title="Review &amp; post" subtitle="Check the extracted figures: OCR can misread. Then post as a GRN." />

      {notFound && <p className="text-sm text-destructive">This scan could not be loaded. It may have been deleted.</p>}

      {report && (
        <div className="mb-6 rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success">
          <p className="font-medium">
            Posted {report.posted} {report.posted === 1 ? "invoice" : "invoices"}{report.failed > 0 ? `, ${report.failed} failed` : ""}.
          </p>
          {report.failed > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {report.results.filter((r) => !r.ok).map((r, i) => <li key={i}>{r.invoiceNo}: {r.error}</li>)}
            </ul>
          )}
          <div className="mt-1 flex gap-3">
            <Link to="/purchases" className="font-medium underline">View GRNs →</Link>
            <Link to="/purchases/scan" className="font-medium underline">Back to import →</Link>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-md border border-border bg-surface p-3 text-xs text-text-secondary">
          {issues.map((m, i) => <li key={i}>• {m}</li>)}
        </ul>
      )}

      {result && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <span className="text-xs font-medium">Extracted: review before posting</span>
            <span className="text-xs text-text-tertiary">
              {result.invoices.length} invoice{result.invoices.length === 1 ? "" : "s"} · {result.lineCount} lines
              {result.errorCount > 0 ? ` · ${result.errorCount} errors` : ""}
            </span>
          </div>
          <ul className="max-h-80 divide-y divide-divider overflow-auto">
            {result.invoices.map((inv) => {
              const totals = grnTotals(inv.lines, false);
              return (
                <li key={inv.key} className="px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{inv.invoiceNo || "(no invoice no)"}</span>
                    <span className="text-text-tertiary">·</span>
                    <span className="truncate">{inv.vendorName || "(no vendor)"}</span>
                    {!inv.valid && <Badge variant="danger">has errors</Badge>}
                    {dupes.has(inv.key) && <Badge variant="warning">duplicate · {dupes.get(inv.key)}</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-tertiary">
                    <span>{inv.date ?? "no date"}</span>
                    <span>{inv.lines.length} lines</span>
                    <span className="text-text-primary">Total {formatPaise(totals.grandTotalPaise)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {result.issues.length > 0 && (
            <ul className="max-h-40 divide-y divide-divider overflow-auto border-t border-border text-xs">
              {result.issues.map((p, i) => (
                <li key={i} className="flex gap-2 px-3 py-1.5">
                  <span className="text-text-tertiary">Row {p.row}</span>
                  <span className={p.level === "error" ? "text-destructive" : "text-warning"}>{p.level}:</span>
                  <span>{p.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border p-3">
            <p className="text-xs text-text-tertiary">Missing vendors/items are created on post.</p>
            <Button onClick={doImport} disabled={importing || postable === 0}>
              <Upload /> {importing ? "Posting…" : `Post ${postable} invoice(s)`}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <ShopSetupDialog open={setupOpen} onOpenChange={setSetupOpen} onResolved={() => void doImport()} />
    </Page>
  );
}

/** Router: `?scan=<id>` opens the review/post screen; otherwise the Import surface. */
export function OcrInvoiceImportPage() {
  const [sp] = useSearchParams();
  const scanId = sp.get("scan");
  return scanId ? <ScanReview scanId={scanId} /> : <ImportSurface />;
}
