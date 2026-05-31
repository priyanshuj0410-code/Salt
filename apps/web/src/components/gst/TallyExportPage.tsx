import { useEffect, useMemo, useState } from "react";
import { FileCode2, Download } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { buildTallyXml, shiftPeriod, type TallySaleRow, type TallyPurchaseRow } from "@/lib/gst";

interface SaleFetch {
  invoice_no: string | null;
  invoice_date: string;
  payment_method: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: { name: string | null } | null;
}
interface PurchaseFetch {
  grn_no: string | null;
  vendor_invoice_no: string | null;
  received_date: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  vendor: { name: string | null } | null;
}

const SALE_COLS = "invoice_no,invoice_date,payment_method,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,ledgers(name)";
const PURCHASE_COLS = "grn_no,vendor_invoice_no,received_date,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,vendor:ledgers(name)";

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function TallyExportPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [sales, setSales] = useState<TallySaleRow[]>([]);
  const [purchases, setPurchases] = useState<TallyPurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const start = `${period}-01`;
    const end = `${shiftPeriod(period, 1)}-01`;
    (async () => {
      setLoading(true);
      const salesQ = supabase
        .from("sales_invoices")
        .select(SALE_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "placed")
        .eq("posts_effects", true)
        .gte("invoice_date", start)
        .lt("invoice_date", end);
      const purchasesQ = supabase
        .from("purchases")
        .select(PURCHASE_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "received")
        .eq("posts_effects", true)
        .gte("received_date", start)
        .lt("received_date", end);
      const [s, p] = await Promise.all([salesQ, purchasesQ]);
      if (!active) return;
      setSales(
        ((s.data as unknown as SaleFetch[] | null) ?? []).map((r) => {
          const cashLike = r.payment_method !== "credit";
          const party = r.ledgers?.name ?? "";
          return {
            invoiceNo: r.invoice_no ?? "",
            date: r.invoice_date,
            partyName: cashLike ? "Cash" : party || "Cash", // credit → party ledger; else Cash
            taxablePaise: r.taxable_paise,
            cgstPaise: r.cgst_paise,
            sgstPaise: r.sgst_paise,
            igstPaise: r.igst_paise,
            totalPaise: r.total_paise,
          };
        }),
      );
      setPurchases(
        ((p.data as unknown as PurchaseFetch[] | null) ?? []).map((r) => ({
          invoiceNo: r.vendor_invoice_no ?? r.grn_no ?? "",
          date: r.received_date,
          vendorName: r.vendor?.name ?? "Sundry Creditors",
          taxablePaise: r.taxable_paise,
          cgstPaise: r.cgst_paise,
          sgstPaise: r.sgst_paise,
          igstPaise: r.igst_paise,
          totalPaise: r.total_paise,
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, period]);

  const salesTotal = useMemo(() => sales.reduce((s, r) => s + r.totalPaise, 0), [sales]);
  const purchasesTotal = useMemo(() => purchases.reduce((s, r) => s + r.totalPaise, 0), [purchases]);
  const hasData = sales.length > 0 || purchases.length > 0;
  const companyName = membership?.orgName ?? shop?.name ?? "Company";

  return (
    <Page width="lg">
      <PageHeader
        icon={FileCode2}
        title="Tally export"
        subtitle={<span>{shop?.name ?? "This shop"} · sales + purchase vouchers for your accountant</span>}
        actions={
          <>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[10.5rem]" aria-label="Export month" />
            <Button
              disabled={!hasData}
              onClick={() => download(`tally-${period}.xml`, buildTallyXml(companyName, sales, purchases), "application/xml")}
            >
              <Download /> Tally XML
            </Button>
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Pick a shop to export its books." />
      ) : !loading && !hasData ? (
        <EmptyState title="Nothing to export" hint={`No placed sales or received purchases for ${period}.`} />
      ) : (
        <div className="flex flex-col gap-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Sales vouchers" value={sales.length} />
            <StatCard label="Sales value" value={formatPaise(salesTotal)} />
            <StatCard label="Purchase vouchers" value={purchases.length} />
            <StatCard label="Purchase value" value={formatPaise(purchasesTotal)} />
          </div>

          <section className="grid gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
            <h2 className="font-semibold text-text-secondary">What the file contains</h2>
            <p className="text-text-secondary">
              A Tally <span className="tabular-nums">Import Data</span> envelope with one <strong>Sales</strong> voucher per bill and one{" "}
              <strong>Purchase</strong> voucher per GRN for {period}, each a balanced double entry with the GST split:
            </p>
            <ul className="ml-4 list-disc text-text-tertiary">
              <li>Sale — Dr party/Cash · Cr Sales (taxable) · Cr Output CGST/SGST/IGST</li>
              <li>Purchase — Dr Purchase (taxable) · Dr Input CGST/SGST/IGST · Cr vendor</li>
            </ul>
            <p className="text-text-tertiary">
              Ledgers are referenced by name (Sales, Purchase, Output/Input CGST/SGST/IGST, Cash, and party names) — Tally maps or
              creates them on import. Cash/UPI/card bills post to <strong>Cash</strong>; credit bills to the party ledger.
            </p>
          </section>
        </div>
      )}
    </Page>
  );
}
