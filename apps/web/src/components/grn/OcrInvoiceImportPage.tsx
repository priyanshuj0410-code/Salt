import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileUp, ScanLine, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  updateScan,
  uploadScanFile,
} from "@/lib/invoiceScans";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";
import { findExistingInvoice } from "@/lib/purchaseDedup";

interface VendorRow { id: string; name: string; gstin: string | null }
interface ItemRow { id: string; name: string; item_code: string | null; barcode: string | null }

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("could not read file"));
    r.readAsDataURL(file);
  });

const isCsv = (f: File) => /csv/i.test(f.type) || f.name.toLowerCase().endsWith(".csv");

/** Parse one CSV file to canonical rows: deterministic first (instant + free), then AI
 *  normalisation if the columns aren't recognised. Mirrors the old CSV importer. */
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
  // Columns weren't recognised → let AI normalise this file (extract-invoice text mode).
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const out = await invokeExtract(btoa(bin), "text/csv");
  if (out.json) return { rows: ocrInvoiceToRows(out.json).rows, usedAi: true };
  return { rows: [], usedAi: false };
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
  if (!supabase) return { vendors: [] as VendorRow[], items: [] as ItemRow[] };
  const [v, it] = await Promise.all([
    supabase.from("ledgers").select("id,name,gstin").eq("org_id", orgId),
    supabase.from("items").select("id,name,item_code,barcode").eq("org_id", orgId),
  ]);
  return { vendors: (v.data as VendorRow[]) ?? [], items: (it.data as ItemRow[]) ?? [] };
}

interface PostResult { invoiceNo: string; ok: boolean; error?: string }

/**
 * Unified purchase-invoice import (SALT-027 + queue unification). Upload PDFs, photos,
 * or CSVs — every invoice lands in the one `invoice_scans` queue (status-tracked in scan
 * history) and dedups against the whole queue (posted GRNs ∪ in-flight scans), so the
 * same bill on either channel is flagged. Routing:
 *   • single PDF/image  → extract inline → review → post (fast path)
 *   • CSV (1+ files)     → parse client-side (deterministic→AI) → write `extracted` rows
 *                          → inline review → bulk post
 *   • many / mixed files → queue for background extraction → review from scan history
 * Posting reuses the existing receive_purchase path (auto-creating missing vendors/items).
 */
export function OcrInvoiceImportPage() {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const blockers = useShopBlockers();
  const [sp] = useSearchParams();

  const [fileName, setFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [ocrIssues, setOcrIssues] = useState<string[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [report, setReport] = useState<{ posted: number; failed: number; results: PostResult[] } | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // Invoice key → existing GRN/scan ref (dedup badge); and invoice key → its scan-row id
  // (to mark the row posted + linked once its GRN is created).
  const [dupes, setDupes] = useState<Map<string, string>>(new Map());
  const [scanIdByKey, setScanIdByKey] = useState<Map<string, string>>(new Map());
  // Multi-file: queued background extraction (process-scans). batchMsg is the receipt.
  const [batching, setBatching] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  function resetForUpload(name: string) {
    setFileName(name);
    setResult(null);
    setReport(null);
    setError(null);
    setNotConfigured(false);
    setOcrIssues([]);
    setAiNote(null);
    setBatchMsg(null);
    setDupes(new Map());
    setScanIdByKey(new Map());
  }

  // Flag invoices already captured for this org (dedup, check-before-post): a posted GRN
  // or an in-flight scan on either channel. `exclude` skips this upload's own rows.
  const computeDupes = useCallback(
    async (invoices: ParsedPurchaseInvoice[], exclude: string[]): Promise<Map<string, string>> => {
      const m = new Map<string, string>();
      if (!orgId) return m;
      for (const inv of invoices) {
        if (!inv.invoiceNo) continue;
        const ex = await findExistingInvoice(orgId, inv.invoiceNo, inv.vendorName, { excludeIds: exclude });
        if (ex) m.set(inv.key, ex.ref);
      }
      return m;
    },
    [orgId],
  );

  // Parse + persist one CSV file: upload it once, then write one `extracted` (or
  // `duplicate`) scan row per invoice it contains. Returns what was written so the
  // caller can build the review + the post-time scan linkage.
  async function persistCsvFile(
    file: File,
    batchId: string,
  ): Promise<{ rows: PurchaseRawRow[]; usedAi: boolean; written: { key: string; scanId: string; dupRef: string | null }[] }> {
    const { rows, usedAi } = await parseCsvFileToRows(file);
    const written: { key: string; scanId: string; dupRef: string | null }[] = [];
    if (!orgId || rows.length === 0) return { rows, usedAi, written };
    const jsons = rowsToOcrInvoices(rows);
    if (jsons.length === 0) return { rows, usedAi, written };
    const invoices = parsePurchaseInvoices(rows).invoices;
    const b64 = await readAsBase64(file);
    const up = await uploadScanFile(orgId, file, b64);
    if (up.error) {
      setOcrIssues((c) => [...c, `Could not save ${file.name} to scan history: ${up.error}`]);
      return { rows, usedAi, written };
    }
    const fileMeta = { path: up.path, filename: file.name, mime: file.type || null };
    for (const { key, json } of jsons) {
      const inv = invoices.find((i) => i.key === key);
      if (!inv || !inv.valid) continue; // only postable invoices enter the queue
      const ex = await findExistingInvoice(orgId, inv.invoiceNo, inv.vendorName);
      const created = await insertExtractedScan(orgId, shopId ?? null, fileMeta, json, ex?.ref, batchId);
      if (created.id && !created.error) written.push({ key, scanId: created.id, dupRef: ex?.ref ?? null });
    }
    return { rows, usedAi, written };
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0 || !supabase || !orgId) return;
    // CSV-only (one or many) → parse client-side + inline bulk review (free + instant,
    // no OCR cost).
    if (files.every(isCsv)) {
      await onCsvFiles(files);
      return;
    }
    // Any PDF/image (single, many, or mixed) → the free local-Gemma queue. The user
    // reviews from scan history once the worker extracts (or hits "Fetch now" there for
    // instant Flash). This is the default per the queue flip — no Gemini cost per upload.
    await onMultiFile(files);
  }

  // CSV-only upload: parse + persist each file as extracted scan rows, then show the
  // merged invoices inline for a bulk review + post (preserving the old CSV UX).
  async function onCsvFiles(files: File[]) {
    resetForUpload(files.length === 1 ? files[0].name : `${files.length} files`);
    setExtracting(true);
    try {
      const batchId = crypto.randomUUID();
      const allRows: PurchaseRawRow[] = [];
      const m = new Map<string, string>();
      const dupMap = new Map<string, string>();
      let usedAi = false;
      for (const file of files) {
        const { rows, usedAi: ai, written } = await persistCsvFile(file, batchId);
        if (ai) usedAi = true;
        allRows.push(...rows);
        for (const w of written) {
          m.set(w.key, w.scanId);
          if (w.dupRef) dupMap.set(w.key, w.dupRef);
        }
      }
      if (usedAi) setAiNote("Some columns weren't recognised — normalised with AI. Double-check the figures before posting.");
      if (allRows.length === 0) {
        setError("Couldn't read these CSVs. Use the template below, or set up OCR for AI normalisation.");
        return;
      }
      setScanIdByKey(m);
      setDupes(dupMap);
      setResult(parsePurchaseInvoices(allRows));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the CSV.");
    } finally {
      setExtracting(false);
    }
  }

  // PDF/image uploads → the free local-Gemma queue (lane=queue, pending), drained by the
  // worker (~6h TAT). CSVs are parsed client-side here too (instant + free) and land
  // `extracted`. No Gemini kickoff — "Fetch now" in scan history is the paid instant path.
  async function onMultiFile(files: File[]) {
    resetForUpload(files.length === 1 ? files[0].name : `${files.length} files`);
    setBatching(true);
    try {
      const batchId = crypto.randomUUID();
      let queued = 0;
      for (const file of files) {
        if (isCsv(file)) {
          const { rows, written } = await persistCsvFile(file, batchId);
          queued += written.length;
          if (rows.length === 0) setOcrIssues((c) => [...c, `Could not read ${file.name}.`]);
          continue;
        }
        const b64 = await readAsBase64(file);
        const created = await createScan(orgId!, shopId ?? null, file, b64, batchId);
        if (!created.error) queued += 1;
      }
      if (queued === 0) {
        setError("Could not queue any invoices. Is scan history set up (migration 0049)?");
        return;
      }
      setBatchMsg(`Queued ${queued} invoice${queued === 1 ? "" : "s"} for free extraction (~6h). Track them in Scan history — or use Fetch now there for instant results.`);
    } finally {
      setBatching(false);
    }
  }

  // Review + post a background-extracted scan opened from history (?scan=<id>): load its
  // stored JSON into the same review/post flow — no re-extraction.
  useEffect(() => {
    const scanParam = sp.get("scan");
    if (!scanParam || !orgId) return;
    let active = true;
    (async () => {
      const json = await getScanJson(orgId, scanParam);
      if (!active || !json) return;
      const mapped = ocrInvoiceToRows(json);
      const parsed = parsePurchaseInvoices(mapped.rows);
      const m = new Map<string, string>();
      for (const inv of parsed.invoices) m.set(inv.key, scanParam);
      const dup = await computeDupes(parsed.invoices, [scanParam]);
      if (!active) return;
      setFileName("(from scan history)");
      setOcrIssues(mapped.issues);
      setScanIdByKey(m);
      setDupes(dup);
      setResult(parsed);
    })();
    return () => {
      active = false;
    };
  }, [orgId, sp, computeDupes]);

  async function doImport() {
    if (!supabase || !orgId || !result) return;
    // Pre-flight: the shop needs a state_code or receive_purchase trips the
    // is_interstate NOT NULL. Pop the rescue dialog and bail; it retries the import.
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
        setError("No valid invoice to import — fix the flagged fields, or everything was a duplicate.");
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

      // Create missing vendors.
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
      // Create missing items.
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
        const { data, error: e } = await supabase.from("items").insert(payload).select("id,name,item_code,barcode");
        if (e) { setError(`Could not create items: ${e.message}`); return; }
        for (const row of (data as ItemRow[]) ?? []) {
          if (row.item_code) iMap.set(`code:${row.item_code.toLowerCase()}`, row.id);
          if (row.barcode) iMap.set(`bar:${row.barcode.toLowerCase()}`, row.id);
          iMap.set(`name:${row.name.toLowerCase()}`, row.id);
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
        // Mark this invoice's queue row posted + linked to the GRN it produced.
        const sid = scanIdByKey.get(inv.key);
        if (!e && sid && typeof grnId === "string") {
          await updateScan(sid, { status: "posted", purchase_id: grnId });
        }
      }

      await loadCatalog(orgId);
      const posted = results.filter((r) => r.ok).length;
      setReport({ posted, failed: results.length - posted, results });
      if (results.every((r) => r.ok)) { setResult(null); setFileName(null); }
    } finally {
      setImporting(false);
    }
  }

  const postable = result ? result.invoices.filter((i) => i.valid && !dupes.has(i.key)).length : 0;

  return (
    <Page width="md">
      <Link to="/purchases" className="mb-2 inline-block text-sm text-text-tertiary hover:text-text-primary">
        ← Purchases
      </Link>
      <PageHeader
        icon={ScanLine}
        title="Import invoices"
        subtitle="Upload distributor invoices — PDF, photo, or CSV. PDFs and photos queue for free background extraction (~6h); CSVs parse instantly. Review each in Scan history, then post as a GRN (stock, payable, ITC) — missing vendors/items are created. Need one now? Use Fetch now (instant) in Scan history."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="invoice-file" className={cn(buttonVariants({ variant: "default" }), "cursor-pointer", (extracting || batching) && "pointer-events-none opacity-60")}>
          <FileUp />
          {batching ? "Uploading…" : extracting ? "Reading…" : fileName ?? "Choose files (PDF · image · CSV)"}
        </label>
        <input
          id="invoice-file"
          type="file"
          accept="application/pdf,image/*,.csv,text/csv"
          multiple
          className="hidden"
          onChange={onFile}
          disabled={extracting || batching}
        />
        <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-text-tertiary">
          <Download /> CSV template
        </Button>
        <Link to="/purchases/scans" className="text-sm text-text-tertiary hover:text-text-primary">
          scan history →
        </Link>
      </div>

      {aiNote && (
        <div className="mt-4 rounded-md border border-warning-border bg-warning-bg p-3 text-xs text-warning">{aiNote}</div>
      )}

      {batchMsg && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm">
          <p>{batchMsg}</p>
          <Link to="/purchases/scans" className="mt-1 inline-block font-medium text-primary underline">Open Scan history →</Link>
        </div>
      )}

      {notConfigured && (
        <div className="mt-6 rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning">
          <p className="font-medium">OCR isn't set up yet.</p>
          <p className="mt-1 text-xs">
            The <code>extract-invoice</code> Edge Function needs to be deployed and a vision API key set
            (<code>supabase functions deploy extract-invoice</code> + <code>supabase secrets set GEMINI_API_KEY=…</code>).
            Until then, import a <strong>CSV</strong> here instead — that path needs no OCR.
          </p>
        </div>
      )}

      {ocrIssues.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md border border-border bg-surface p-3 text-xs text-text-secondary">
          {ocrIssues.map((m, i) => <li key={i}>• {m}</li>)}
        </ul>
      )}

      {report && (
        <div className="mt-6 rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success">
          <p className="font-medium">
            Posted {report.posted} {report.posted === 1 ? "invoice" : "invoices"}{report.failed > 0 ? `, ${report.failed} failed` : ""}.
          </p>
          {report.failed > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {report.results.filter((r) => !r.ok).map((r, i) => <li key={i}>{r.invoiceNo}: {r.error}</li>)}
            </ul>
          )}
          <Link to="/purchases" className="mt-1 inline-block font-medium underline">View GRNs →</Link>
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <span className="text-xs font-medium">Extracted — review before posting</span>
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
            <p className="text-xs text-text-tertiary">Check the extracted figures — OCR can misread. Each invoice posts on its own.</p>
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
