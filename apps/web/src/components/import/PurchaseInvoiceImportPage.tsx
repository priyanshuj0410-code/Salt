import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { Download, FileUp, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/patterns/page";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { formatPaise } from "@/lib/currency";
import { grnTotals } from "@/lib/grn";
import { buildReceivePurchasePayload, type PurchaseLine } from "@/lib/orders";
import { parseGstin } from "@/lib/gstin";
import {
  canonicalPurchaseHeader,
  parsePurchaseInvoices,
  purchaseTemplateCsv,
  type ParsedPurchaseInvoice,
  type PurchaseImportResult,
  type PurchaseRawRow,
} from "@/lib/importPurchaseInvoice";
import { useShopBlockers } from "@/lib/useShopBlockers";
import { ShopSetupDialog } from "@/components/settings/ShopSetupDialog";

interface VendorRow { id: string; name: string; gstin: string | null }
interface ItemRow { id: string; name: string; item_code: string | null; barcode: string | null }

async function loadMasters(orgId: string): Promise<{ vendors: VendorRow[]; items: ItemRow[] }> {
  if (!supabase) return { vendors: [], items: [] };
  const [v, it] = await Promise.all([
    supabase.from("ledgers").select("id,name,gstin").eq("org_id", orgId),
    supabase.from("items").select("id,name,item_code,barcode").eq("org_id", orgId),
  ]);
  return { vendors: (v.data as VendorRow[]) ?? [], items: (it.data as ItemRow[]) ?? [] };
}

function buildVendorMap(vendors: VendorRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of vendors) {
    if (v.gstin) m.set(`gst:${v.gstin.toUpperCase()}`, v.id);
    m.set(`name:${v.name.toLowerCase()}`, v.id);
  }
  return m;
}
function resolveVendorId(map: Map<string, string>, inv: ParsedPurchaseInvoice): string | null {
  if (inv.vendorGstin) {
    const byGst = map.get(`gst:${inv.vendorGstin.toUpperCase()}`);
    if (byGst) return byGst;
  }
  return map.get(`name:${inv.vendorName.toLowerCase()}`) ?? null;
}

function buildItemMap(items: ItemRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    if (it.item_code) m.set(`code:${it.item_code.toLowerCase()}`, it.id);
    if (it.barcode) m.set(`bar:${it.barcode.toLowerCase()}`, it.id);
    m.set(`name:${it.name.toLowerCase()}`, it.id);
  }
  return m;
}
function resolveItemId(
  map: Map<string, string>,
  line: { itemCode: string; barcode: string; name: string },
): string | null {
  if (line.itemCode) {
    const byCode = map.get(`code:${line.itemCode.toLowerCase()}`);
    if (byCode) return byCode;
  }
  if (line.barcode) {
    const byBar = map.get(`bar:${line.barcode.toLowerCase()}`);
    if (byBar) return byBar;
  }
  return map.get(`name:${line.name.toLowerCase()}`) ?? null;
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

interface PostResult { invoiceNo: string; ok: boolean; error?: string }
interface Report { posted: number; failed: number; vendorsCreated: number; itemsCreated: number; results: PostResult[] }

export function PurchaseInvoiceImportPage() {
  const { membership, shopId } = useAuth();
  const orgId = membership?.orgId;
  const loadCatalog = useCatalog((s) => s.load);
  const blockers = useShopBlockers();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseImportResult | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);

  // Load the masters once so the dry-run preview can mark each vendor/item as
  // existing vs "will create". setState only in the async .then (lint rule).
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    loadMasters(orgId).then((m) => {
      if (!active) return;
      setVendors(m.vendors);
      setItems(m.items);
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  const vendorMap = useMemo(() => buildVendorMap(vendors), [vendors]);
  const itemMap = useMemo(() => buildItemMap(items), [items]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setError(null);
    Papa.parse<PurchaseRawRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: canonicalPurchaseHeader,
      complete: (res) => setResult(parsePurchaseInvoices(res.data)),
    });
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
        setError("No valid invoices to import — fix the errors and re-upload.");
        return;
      }

      // Re-read masters fresh, then create anything missing.
      const masters = await loadMasters(orgId);
      const vMap = buildVendorMap(masters.vendors);
      const iMap = buildItemMap(masters.items);

      const newVendors = new Map<string, { name: string; gstin: string }>();
      for (const inv of valid) {
        if (resolveVendorId(vMap, inv) == null) {
          const k = inv.vendorGstin ? `gst:${inv.vendorGstin.toUpperCase()}` : `name:${inv.vendorName.toLowerCase()}`;
          if (!newVendors.has(k)) newVendors.set(k, { name: inv.vendorName, gstin: inv.vendorGstin });
        }
      }
      let vendorsCreated = 0;
      if (newVendors.size) {
        const payload = [...newVendors.values()].map((v) => ({
          org_id: orgId,
          name: v.name,
          type: "supplier",
          gstin: v.gstin || null,
          state_code: v.gstin ? parseGstin(v.gstin).stateCode : null,
        }));
        const { data, error: e } = await supabase.from("ledgers").insert(payload).select("id,name,gstin");
        if (e) {
          setError(`Could not create vendors: ${e.message}`);
          return;
        }
        for (const row of (data as VendorRow[]) ?? []) {
          if (row.gstin) vMap.set(`gst:${row.gstin.toUpperCase()}`, row.id);
          vMap.set(`name:${row.name.toLowerCase()}`, row.id);
        }
        vendorsCreated = data?.length ?? 0;
      }

      const newItems = new Map<string, { code: string; barcode: string; name: string; hsn: string; gst: number }>();
      for (const inv of valid) {
        for (const line of inv.lines) {
          if (resolveItemId(iMap, line) == null) {
            const k = line.itemCode
              ? `code:${line.itemCode.toLowerCase()}`
              : line.barcode
                ? `bar:${line.barcode.toLowerCase()}`
                : `name:${line.name.toLowerCase()}`;
            if (!newItems.has(k)) newItems.set(k, { code: line.itemCode, barcode: line.barcode, name: line.name, hsn: line.hsn, gst: line.gstRate });
          }
        }
      }
      let itemsCreated = 0;
      if (newItems.size) {
        const payload = [...newItems.values()].map((it) => ({
          org_id: orgId,
          name: it.name,
          item_code: it.code || null,
          barcode: it.barcode || null,
          hsn: it.hsn || null,
          gst_rate: it.gst,
          schedule: "OTC",
        }));
        const { data, error: e } = await supabase.from("items").insert(payload).select("id,name,item_code,barcode");
        if (e) {
          setError(`Could not create items: ${e.message}`);
          return;
        }
        for (const row of (data as ItemRow[]) ?? []) {
          if (row.item_code) iMap.set(`code:${row.item_code.toLowerCase()}`, row.id);
          if (row.barcode) iMap.set(`bar:${row.barcode.toLowerCase()}`, row.id);
          iMap.set(`name:${row.name.toLowerCase()}`, row.id);
        }
        itemsCreated = data?.length ?? 0;
      }

      // Post each invoice through receive_purchase (each is its own transaction).
      const payment = { method: "credit" as const, creditDays: 0 };
      const results: PostResult[] = [];
      for (const inv of valid) {
        const vendorId = resolveVendorId(vMap, inv);
        if (!vendorId) {
          results.push({ invoiceNo: inv.invoiceNo, ok: false, error: "vendor could not be resolved" });
          continue;
        }
        const plines: PurchaseLine[] = [];
        let unresolved = false;
        for (const line of inv.lines) {
          const itemId = resolveItemId(iMap, line);
          if (!itemId) {
            unresolved = true;
            break;
          }
          plines.push({
            itemId,
            name: line.name,
            batchNo: line.batchNo,
            expiry: line.expiry,
            qty: line.qty,
            freeQty: line.freeQty,
            ptrPaise: line.ptrPaise,
            mrpPaise: line.mrpPaise,
            gstRate: line.gstRate,
            discountType: line.discountType ?? undefined,
            discountValue: line.discountValue,
            schemeText: line.schemeText,
          });
        }
        if (unresolved) {
          results.push({ invoiceNo: inv.invoiceNo, ok: false, error: "an item could not be resolved" });
          continue;
        }
        const args = buildReceivePurchasePayload(
          shopId,
          { id: vendorId, name: inv.vendorName },
          plines,
          payment,
          false, // taxable_paise is split-independent; receive_purchase derives CGST/SGST/IGST itself
          { vendorInvoiceNo: inv.invoiceNo, vendorInvoiceDate: inv.date ?? undefined },
        );
        const { error: e } = await supabase.rpc("receive_purchase", args);
        results.push({ invoiceNo: inv.invoiceNo, ok: !e, error: e?.message });
      }

      await loadCatalog(orgId);
      const masters2 = await loadMasters(orgId);
      setVendors(masters2.vendors);
      setItems(masters2.items);
      const posted = results.filter((r) => r.ok).length;
      setReport({ posted, failed: results.length - posted, vendorsCreated, itemsCreated, results });
      if (results.every((r) => r.ok)) {
        setResult(null);
        setFileName(null);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Page width="sm">
      <Link to="/import" className="text-sm font-medium text-muted-foreground hover:text-foreground">
        ← Import
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Import purchase invoices</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload your vendor bills (one row per line). Each invoice posts as a GRN — adding stock, the vendor
        payable, and ITC, exactly like entering it by hand. Missing vendors and items are created automatically.
        For past records that should <em>not</em> re-post stock, use{" "}
        <Link to="/import/smart" className="font-medium text-primary hover:underline">Smart Import</Link> instead.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" onClick={downloadTemplate}>
          <Download />
          Download template
        </Button>
        <label htmlFor="purchase-file" className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
          <FileUp />
          {fileName ?? "Choose CSV file"}
        </label>
        <input id="purchase-file" type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </div>

      {report && (
        <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">
            Posted {report.posted} {report.posted === 1 ? "invoice" : "invoices"}
            {report.failed > 0 ? `, ${report.failed} failed` : ""}.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Created {report.vendorsCreated} {report.vendorsCreated === 1 ? "vendor" : "vendors"} and{" "}
            {report.itemsCreated} {report.itemsCreated === 1 ? "item" : "items"}.
          </p>
          {report.failed > 0 && (
            <ul className="mt-2 space-y-1">
              {report.results.filter((r) => !r.ok).map((r, i) => (
                <li key={i} className="text-xs text-destructive">
                  {r.invoiceNo}: {r.error}
                </li>
              ))}
            </ul>
          )}
          <Link to="/purchases" className="mt-1 inline-block font-medium text-primary hover:underline">
            View GRNs →
          </Link>
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium">Dry run — preview only, nothing posted yet</span>
            <span className="text-xs text-muted-foreground">
              {result.invoices.length} invoices · {result.lineCount} lines
              {result.errorCount > 0 ? ` · ${result.errorCount} errors` : ""}
              {result.warningCount > 0 ? ` · ${result.warningCount} warnings` : ""}
            </span>
          </div>

          <ul className="max-h-80 divide-y overflow-auto">
            {result.invoices.map((inv) => {
              const totals = grnTotals(inv.lines, false);
              const vendorExists = resolveVendorId(vendorMap, inv) != null;
              const newItemCount = inv.lines.filter((l) => resolveItemId(itemMap, l) == null).length;
              return (
                <li key={inv.key} className="px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{inv.invoiceNo}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="truncate">{inv.vendorName}</span>
                    <Badge variant={vendorExists ? "secondary" : "outline"}>
                      {vendorExists ? "vendor on file" : "new vendor"}
                    </Badge>
                    {!inv.valid && <Badge variant="destructive">has errors</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{inv.date ?? "no date"}</span>
                    <span>{inv.lines.length} lines</span>
                    {newItemCount > 0 && <span>{newItemCount} new {newItemCount === 1 ? "item" : "items"}</span>}
                    <span className="text-foreground">Total {formatPaise(totals.grandTotalPaise)}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {result.issues.length > 0 && (
            <ul className="max-h-48 divide-y overflow-auto border-t text-sm">
              {result.issues.map((p, i) => (
                <li key={i} className="flex gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground">Row {p.row}</span>
                  <span className={p.level === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-500"}>
                    {p.level === "error" ? "Error" : "Warning"}:
                  </span>
                  <span>{p.message}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t p-3">
            <p className="text-xs text-muted-foreground">
              Each invoice posts on its own. Re-running re-posts — fix errors and re-import only what failed.
            </p>
            <Button onClick={doImport} disabled={importing || result.invoices.filter((i) => i.valid).length === 0}>
              <Upload />
              {importing ? "Posting…" : `Post ${result.invoices.filter((i) => i.valid).length} invoices`}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <ShopSetupDialog open={setupOpen} onOpenChange={setSetupOpen} onResolved={() => void doImport()} />
    </Page>
  );
}
