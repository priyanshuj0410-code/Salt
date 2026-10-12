import { useEffect, useMemo, useState } from "react";
import { BadgeIndianRupee, Download } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";
import {
  buildItcRegister,
  buildItcReversal,
  itcRegisterToCsv,
  shiftPeriod,
  type ItcInvoiceRow,
  type ItcReversalRow,
  type ExpiredBatchInput,
} from "@/lib/gst";

interface PurchaseFetch {
  grn_no: string | null;
  vendor_invoice_no: string | null;
  received_date: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  vendor: { name: string | null; gstin: string | null } | null;
}
interface BatchFetch {
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  ptr_paise: number;
  items: { name: string | null; gst_rate: number } | null;
}

const PURCHASE_COLS = "grn_no,vendor_invoice_no,received_date,taxable_paise,cgst_paise,sgst_paise,igst_paise,vendor:ledgers(name,gstin)";
const BATCH_COLS = "batch_no,expiry,qty,ptr_paise,items(name,gst_rate)";

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ItcRegisterPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const currentMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [period, setPeriod] = useState(currentMonth); // register month
  const [purchases, setPurchases] = useState<ItcInvoiceRow[]>([]);
  const [batches, setBatches] = useState<ExpiredBatchInput[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const start = `${period}-01`;
    const end = `${shiftPeriod(period, 1)}-01`;
    (async () => {
      setLoading(true);
      const purchasesQ = supabase
        .from("purchases")
        .select(PURCHASE_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "received")
        .eq("posts_effects", true)
        .gte("received_date", start)
        .lt("received_date", end);
      // Currently-expired stock (org-wide; RLS scopes to the org). Expiry is 'YYYY-MM'.
      const batchesQ = supabase.from("batches").select(BATCH_COLS).gt("qty", 0).neq("expiry", "").lt("expiry", currentMonth);
      const [p, b] = await Promise.all([purchasesQ, batchesQ]);
      if (!active) return;
      setPurchases(
        ((p.data as unknown as PurchaseFetch[] | null) ?? []).map((r) => ({
          invoiceNo: r.vendor_invoice_no ?? r.grn_no ?? "-",
          date: r.received_date,
          vendorName: r.vendor?.name ?? "-",
          vendorGstin: r.vendor?.gstin ?? "",
          taxablePaise: r.taxable_paise,
          cgstPaise: r.cgst_paise,
          sgstPaise: r.sgst_paise,
          igstPaise: r.igst_paise,
        })),
      );
      setBatches(
        ((b.data as unknown as BatchFetch[] | null) ?? []).map((r) => ({
          itemName: r.items?.name ?? "-",
          batchNo: r.batch_no ?? "-",
          expiry: r.expiry ?? "",
          qty: r.qty,
          ptrPaise: r.ptr_paise,
          gstRate: r.items?.gst_rate ?? 0,
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, period, currentMonth]);

  const register = useMemo(() => buildItcRegister(purchases), [purchases]);
  const reversal = useMemo(() => buildItcReversal(batches, currentMonth), [batches, currentMonth]);
  const hasData = register.count > 0 || reversal.rows.length > 0;
  const netItc = register.totals.itcPaise - reversal.totalReversePaise;

  const subtitle = (
    <span>
      {shop?.name ?? "This shop"} ·{" "}
      {shop?.gstin ? <span className="tabular-nums">{shop.gstin}</span> : <span className="text-warning">no GSTIN set</span>}
    </span>
  );

  return (
    <Page width="lg">
      <PageHeader
        icon={BadgeIndianRupee}
        title="ITC register"
        subtitle={subtitle}
        actions={
          <>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[10.5rem]" aria-label="Register month" />
            <Button variant="outline" disabled={register.count === 0} onClick={() => download(`itc-register-${period}.csv`, itcRegisterToCsv(register), "text/csv")}>
              <Download /> CSV
            </Button>
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="ITC is tracked per shop. Pick a shop to continue." />
      ) : !loading && !hasData ? (
        <EmptyState title="No ITC this period" hint={`No received purchases for ${period}, and no expired stock to reverse.`} />
      ) : (
        <div className="flex flex-col gap-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Taxable value" value={formatPaiseCompact(register.totals.taxablePaise)} valueTitle={formatPaise(register.totals.taxablePaise)} hint={`${register.count} invoices`} />
            <StatCard label="Eligible ITC" value={formatPaiseCompact(register.totals.itcPaise)} valueTitle={formatPaise(register.totals.itcPaise)} tone="success" />
            <StatCard
              label="ITC to reverse"
              value={formatPaiseCompact(reversal.totalReversePaise)} valueTitle={formatPaise(reversal.totalReversePaise)}
              tone={reversal.totalReversePaise > 0 ? "danger" : "default"}
              hint={`${reversal.rows.length} expired batches`}
            />
            <StatCard label="Net ITC" value={formatPaiseCompact(netItc)} valueTitle={formatPaise(netItc)} hint="eligible − reversal" />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-secondary">
              Inward invoices <span className="ml-1 font-normal text-text-tertiary">({register.count})</span>
            </h2>
            <DataTable<ItcInvoiceRow>
              cols="1.4fr 1.3fr 0.9fr 0.8fr 1fr 0.9fr 0.9fr 0.9fr"
              rows={register.rows}
              rowKey={(r) => `${r.invoiceNo}|${r.date}|${r.vendorGstin}`}
              loading={loading}
              empty="No received purchases this month."
              columns={[
                { key: "vendor", header: "Vendor", cell: (r) => r.vendorName },
                { key: "gstin", header: "GSTIN", cell: (r) => <span className="tabular-nums">{r.vendorGstin || "-"}</span> },
                { key: "inv", header: "Invoice", cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span> },
                { key: "date", header: "Date", cell: (r) => r.date },
                { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
                { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
                { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
              ]}
            />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-secondary">
              ITC reversal: expired stock <span className="ml-1 font-normal text-text-tertiary">({reversal.rows.length})</span>
            </h2>
            <DataTable<ItcReversalRow>
              cols="1.6fr 1fr 0.8fr 0.6fr 1fr"
              rows={reversal.rows}
              rowKey={(r) => `${r.itemName}|${r.batchNo}|${r.expiry}`}
              loading={loading}
              empty="No expired stock on hand. Nothing to reverse."
              columns={[
                { key: "item", header: "Item", cell: (r) => r.itemName },
                { key: "batch", header: "Batch", cell: (r) => <span className="tabular-nums">{r.batchNo}</span> },
                { key: "expiry", header: "Expiry", cell: (r) => <span className="tabular-nums">{r.expiry}</span> },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "rev", header: "ITC to reverse", numeric: true, cell: (r) => formatPaise(r.reverseItcPaise) },
              ]}
            />
            <p className="mt-2 text-xs text-text-tertiary">
              Section 17(5)(h): ITC on expired/destroyed stock must be reversed. Estimated as PTR × GST rate × qty
              (advisory, not auto-posted).
            </p>
          </section>
        </div>
      )}
    </Page>
  );
}
