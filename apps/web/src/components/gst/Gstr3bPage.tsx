import { useEffect, useMemo, useState } from "react";
import { Scale, Download } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { buildGstr3b, buildGstr3bJson, gstr3bToCsv, type Gstr3bOutwardRow, type Gstr3bItcRow } from "@/lib/gst";

const OUTWARD_COLS = "taxable_paise,cgst_paise,sgst_paise,igst_paise";
const ITC_COLS = "cgst_paise,sgst_paise,igst_paise";

/** Trigger a client-side file download (same blob pattern as the importer). */
function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface HeadRow {
  head: string;
  outputPaise: number;
  itcPaise: number;
  balancePaise: number;
}

export function Gstr3bPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
  const [sales, setSales] = useState<Gstr3bOutwardRow[]>([]);
  const [purchases, setPurchases] = useState<Gstr3bItcRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const [y, m] = period.split("-").map(Number);
    const start = `${period}-01`;
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of next month

    (async () => {
      setLoading(true);
      // Output tax: placed, operational (non-imported) sales invoices in the month.
      const salesQ = supabase
        .from("sales_invoices")
        .select(OUTWARD_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "placed")
        .eq("posts_effects", true)
        .gte("invoice_date", start)
        .lt("invoice_date", end);
      // Eligible ITC: received, operational purchases in the month.
      const purchasesQ = supabase
        .from("purchases")
        .select(ITC_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "received")
        .eq("posts_effects", true)
        .gte("received_date", start)
        .lt("received_date", end);
      const [salesRes, purchasesRes] = await Promise.all([salesQ, purchasesQ]);
      if (!active) return;
      setSales((salesRes.data as unknown as Gstr3bOutwardRow[] | null) ?? []);
      setPurchases((purchasesRes.data as unknown as Gstr3bItcRow[] | null) ?? []);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopId, period]);

  const summary = useMemo(() => buildGstr3b(period, sales, purchases), [period, sales, purchases]);
  const hasData = summary.invoiceCount > 0 || summary.purchaseCount > 0;
  const filerGstin = shop?.gstin ?? "";

  const headRows: HeadRow[] = [
    { head: "IGST", outputPaise: summary.output.igstPaise, itcPaise: summary.itc.igstPaise, balancePaise: summary.balance.igstPaise },
    { head: "CGST", outputPaise: summary.output.cgstPaise, itcPaise: summary.itc.cgstPaise, balancePaise: summary.balance.cgstPaise },
    { head: "SGST", outputPaise: summary.output.sgstPaise, itcPaise: summary.itc.sgstPaise, balancePaise: summary.balance.sgstPaise },
  ];

  const subtitle = (
    <span>
      {shop?.name ?? "This shop"} ·{" "}
      {filerGstin ? (
        <span className="tabular-nums">{filerGstin}</span>
      ) : (
        <span className="text-warning">no GSTIN set on this shop — set it in Settings before filing</span>
      )}
    </span>
  );

  return (
    <Page width="lg">
      <PageHeader
        icon={Scale}
        title="GSTR-3B — summary return"
        subtitle={subtitle}
        actions={
          <>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-[10.5rem]"
              aria-label="Filing period"
            />
            <Button
              variant="outline"
              disabled={!hasData}
              onClick={() => download(`gstr3b-${filerGstin || "shop"}-${period}.json`, JSON.stringify(buildGstr3bJson(summary, filerGstin), null, 2), "application/json")}
            >
              <Download /> JSON
            </Button>
            <Button variant="outline" disabled={!hasData} onClick={() => download(`gstr3b-${period}.csv`, gstr3bToCsv(summary), "text/csv")}>
              <Download /> CSV
            </Button>
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="GSTR-3B is filed per shop GSTIN. Pick a shop to continue." />
      ) : !loading && !hasData ? (
        <EmptyState title="No GST activity this period" hint={`No placed sales or received purchases for ${period}. Pick another month.`} />
      ) : (
        <div className="flex flex-col gap-7">
          <div hidden={!hasData} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Outward taxable value" value={formatPaise(summary.outwardTaxablePaise)} hint={`${summary.invoiceCount} invoices`} />
            <StatCard label="Output tax" value={formatPaise(summary.outputTotalPaise)} />
            <StatCard label="Eligible ITC" value={formatPaise(summary.itcTotalPaise)} hint={`${summary.purchaseCount} purchases`} />
            <StatCard
              label="Net payable"
              value={formatPaise(summary.netPayablePaise)}
              tone={summary.netPayablePaise > 0 ? "danger" : "success"}
              hint={summary.creditCarryPaise > 0 ? `${formatPaise(summary.creditCarryPaise)} credit c/f` : "after full set-off"}
            />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-secondary">By tax head</h2>
            <DataTable<HeadRow>
              cols="1fr 1fr 1fr 1fr"
              rows={headRows}
              rowKey={(r) => r.head}
              loading={loading}
              columns={[
                { key: "head", header: "Tax", cell: (r) => r.head },
                { key: "output", header: "Output", numeric: true, cell: (r) => formatPaise(r.outputPaise) },
                { key: "itc", header: "ITC", numeric: true, cell: (r) => formatPaise(r.itcPaise) },
                {
                  key: "balance",
                  header: "Balance",
                  numeric: true,
                  cell: (r) => (
                    <span className={r.balancePaise > 0 ? "text-text-primary" : "text-success"}>{formatPaise(r.balancePaise)}</span>
                  ),
                },
              ]}
            />
            <p className="mt-2 text-xs text-text-tertiary">
              Balance = output − ITC per head (negative = credit available). Net payable applies full credit set-off
              across heads. ITC reversal (returns / expired stock) is excluded until the Returns module exists.
            </p>
          </section>
        </div>
      )}
    </Page>
  );
}
