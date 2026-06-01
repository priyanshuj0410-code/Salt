import { useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, ScanLine, Upload } from "lucide-react";
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
import { ocrInvoiceToRows } from "@/lib/ocrInvoice";
import {
  parsePurchaseInvoices,
  type ParsedPurchaseInvoice,
  type PurchaseImportResult,
} from "@/lib/importPurchaseInvoice";
import { createScan, invokeExtract, updateScan, vendorGuess } from "@/lib/invoiceScans";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";

interface VendorRow { id: string; name: string; gstin: string | null }
interface ItemRow { id: string; name: string; item_code: string | null; barcode: string | null }

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("could not read file"));
    r.readAsDataURL(file);
  });

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
 * OCR purchase-invoice import (SALT-027). Upload a PDF/image → the extract-invoice
 * Edge Function returns structured JSON → we map it to the CSV-importer row shape
 * (ocrInvoiceToRows) → reuse parsePurchaseInvoices for the dry-run preview → post
 * each invoice through receive_purchase (auto-creating missing vendors/items),
 * exactly like the CSV importer. The OCR call is the only new server dependency;
 * everything after it reuses the existing purchase-import path.
 */
export function OcrInvoiceImportPage() {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const blockers = useShopBlockers();

  const [fileName, setFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [ocrIssues, setOcrIssues] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [report, setReport] = useState<{ posted: number; failed: number; results: PostResult[] } | null>(null);
  // The audit record for the current upload (SALT-221) — links the file + outcome,
  // and its id ties the posted GRN back to the scan.
  const [scanId, setScanId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !supabase || !orgId) return;
    setFileName(file.name);
    setResult(null);
    setReport(null);
    setError(null);
    setNotConfigured(false);
    setOcrIssues([]);
    setScanId(null);
    setExtracting(true);
    try {
      const b64 = await readAsBase64(file);

      // 1. Persist the file + a pending audit row BEFORE calling OCR, so a failed
      //    or interrupted scan is still on record and retryable from storage.
      const created = await createScan(orgId, shopId ?? null, file, b64);
      const sid = created.id || null;
      setScanId(sid);
      if (created.error) {
        // Storage/table may not exist if migration 0049 isn't applied yet — don't
        // block scanning, just note it and continue without the audit record.
        setOcrIssues((cur) => [...cur, `Could not save to scan history: ${created.error}`]);
      }

      // 2. Extract.
      const out = await invokeExtract(b64, file.type || "application/octet-stream");
      if (out.notConfigured) {
        setNotConfigured(true);
        if (sid) await updateScan(sid, { status: "failed", error: "ocr_not_configured" });
        return;
      }
      if (out.error || !out.json) {
        setError(`Extraction failed: ${out.error ?? "no data returned"}`);
        if (sid) await updateScan(sid, { status: "failed", error: out.error ?? "no data" });
        return;
      }

      // 3. Record the extraction + show the dry-run preview.
      if (sid) await updateScan(sid, { status: "extracted", extracted_json: out.json, vendor_guess: vendorGuess(out.json) });
      const mapped = ocrInvoiceToRows(out.json);
      setOcrIssues((cur) => [...cur, ...mapped.issues]);
      setResult(parsePurchaseInvoices(mapped.rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process the file.");
    } finally {
      setExtracting(false);
    }
  }

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
      const valid = result.invoices.filter((i) => i.valid && i.lines.length > 0);
      if (!valid.length) {
        setError("No valid invoice to import — fix the flagged fields or use the CSV importer.");
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
            ptrPaise: l.ptrPaise, mrpPaise: l.mrpPaise, gstRate: l.gstRate,
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
        // Link the scan to the first GRN it produced + mark it posted (SALT-221).
        if (!e && scanId && typeof grnId === "string") {
          await updateScan(scanId, { status: "posted", purchase_id: grnId });
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

  return (
    <Page width="md">
      <Link to="/purchases" className="mb-2 inline-block text-sm text-text-tertiary hover:text-text-primary">
        ← Purchases
      </Link>
      <PageHeader
        icon={ScanLine}
        title="Scan invoice (OCR)"
        subtitle="Upload a distributor invoice PDF or photo. We extract the lines for review, then post each as a GRN — adding stock, payable, and ITC. Missing vendors/items are created."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ocr-file" className={cn(buttonVariants({ variant: "default" }), "cursor-pointer", extracting && "pointer-events-none opacity-60")}>
          <FileUp />
          {extracting ? "Extracting…" : fileName ?? "Choose PDF / image"}
        </label>
        <input id="ocr-file" type="file" accept="application/pdf,image/*" className="hidden" onChange={onFile} disabled={extracting} />
        <Link to="/import/purchases" className="text-sm text-text-tertiary hover:text-text-primary">
          or import a CSV instead →
        </Link>
      </div>

      {notConfigured && (
        <div className="mt-6 rounded-lg border border-warning-border bg-warning-bg p-4 text-sm text-warning">
          <p className="font-medium">OCR isn't set up yet.</p>
          <p className="mt-1 text-xs">
            The <code>extract-invoice</code> Edge Function needs to be deployed and a vision API key set
            (<code>supabase functions deploy extract-invoice</code> + <code>supabase secrets set GEMINI_API_KEY=…</code>).
            Until then, use the{" "}
            <Link to="/import/purchases" className="font-medium underline">CSV importer</Link>.
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
            <Button onClick={doImport} disabled={importing || result.invoices.filter((i) => i.valid).length === 0}>
              <Upload /> {importing ? "Posting…" : `Post ${result.invoices.filter((i) => i.valid).length} invoice(s)`}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <ShopSetupDialog open={setupOpen} onOpenChange={setSetupOpen} onResolved={() => void doImport()} />
    </Page>
  );
}
