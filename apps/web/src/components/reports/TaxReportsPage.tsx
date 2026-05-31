import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt, ExternalLink } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ViewTabs, ExportButton, type ReportView } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { fetchAllPaged } from "@/lib/reportData";
import { istMonth, monthRange, downloadCsv, paiseToRupeeStr } from "@/lib/reports";
import {
  buildGstr1,
  buildGstr3b,
  type Gstr1InvoiceRow,
  type Gstr1LineRow,
  type Gstr3bItcRow,
} from "@/lib/gst";

interface InvoiceFetch {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  is_interstate: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  ledgers: { gstin: string | null; name: string | null; state_code: string | null } | null;
}
interface LineFetch {
  invoice_id: string;
  qty: number;
  gst_rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  items: { hsn: string | null } | null;
}
interface RateRow {
  gst_rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

interface RateAgg {
  rate: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
}

/** Sum tax rows by GST rate (output or ITC), ascending by rate. */
function aggByRate(rows: RateRow[]): RateAgg[] {
  const map = new Map<number, RateAgg>();
  for (const r of rows) {
    let g = map.get(r.gst_rate);
    if (!g) {
      g = { rate: r.gst_rate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0 };
      map.set(r.gst_rate, g);
    }
    g.taxablePaise += r.taxable_paise;
    g.cgstPaise += r.cgst_paise;
    g.sgstPaise += r.sgst_paise;
    g.igstPaise += r.igst_paise;
    g.taxPaise += r.cgst_paise + r.sgst_paise + r.igst_paise;
  }
  return Array.from(map.values()).sort((a, b) => a.rate - b.rate);
}

const INV_COLS =
  "id,invoice_no,invoice_date,is_interstate,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,ledgers(gstin,name,state_code)";
const SALE_LINE_COLS =
  "invoice_id,qty,gst_rate,taxable_paise,cgst_paise,sgst_paise,igst_paise,items(hsn),sales_invoices!inner(invoice_date)";
const PUR_LINE_COLS = "gst_rate,taxable_paise,cgst_paise,sgst_paise,igst_paise,purchases!inner(received_date)";

type ViewKey = "summary" | "hsn" | "rates" | "itc";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "summary", label: "Summary" },
  { key: "hsn", label: "HSN summary" },
  { key: "rates", label: "Output by rate" },
  { key: "itc", label: "ITC / 2B" },
];

const pct = (rate: number) => `${rate}%`;

export function TaxReportsPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();
  const [period, setPeriod] = useState(() => istMonth());
  const [view, setView] = useState<ViewKey>("summary");
  const [invoices, setInvoices] = useState<Gstr1InvoiceRow[]>([]);
  const [saleLines, setSaleLines] = useState<(Gstr1LineRow & RateRow)[]>([]);
  const [purLines, setPurLines] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const db = supabase;
    const { start, end } = monthRange(period);

    (async () => {
      setLoading(true);
      const [invRaw, saleRaw, purRaw] = await Promise.all([
        fetchAllPaged<InvoiceFetch>((f, t) =>
          db
            .from("sales_invoices")
            .select(INV_COLS)
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .eq("status", "placed")
            .eq("posts_effects", true)
            .gte("invoice_date", start)
            .lt("invoice_date", end)
            .range(f, t),
        ),
        fetchAllPaged<LineFetch>((f, t) =>
          db
            .from("sale_lines")
            .select(SALE_LINE_COLS)
            .eq("org_id", orgId)
            .eq("sales_invoices.shop_id", shopId)
            .eq("sales_invoices.status", "placed")
            .eq("sales_invoices.posts_effects", true)
            .gte("sales_invoices.invoice_date", start)
            .lt("sales_invoices.invoice_date", end)
            .range(f, t),
        ),
        fetchAllPaged<RateRow>((f, t) =>
          db
            .from("purchase_lines")
            .select(PUR_LINE_COLS)
            .eq("org_id", orgId)
            .eq("purchases.shop_id", shopId)
            .eq("purchases.status", "received")
            .eq("purchases.posts_effects", true)
            .gte("purchases.received_date", start)
            .lt("purchases.received_date", end)
            .range(f, t),
        ),
      ]);
      if (!active) return;
      setInvoices(invRaw.map((r): Gstr1InvoiceRow => ({ ...r, party: r.ledgers })));
      setSaleLines(saleRaw.map((r) => ({ ...r, hsn: r.items?.hsn ?? null })));
      setPurLines(purRaw);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopId, period]);

  const gstr1 = useMemo(() => buildGstr1(period, shop?.state_code ?? "", invoices, saleLines), [period, shop?.state_code, invoices, saleLines]);
  const gstr3b = useMemo(
    () => buildGstr3b(period, invoices, purLines as Gstr3bItcRow[]),
    [period, invoices, purLines],
  );
  const outputByRate = useMemo(() => aggByRate(saleLines), [saleLines]);
  const itcByRate = useMemo(() => aggByRate(purLines), [purLines]);

  const exporters: Record<ViewKey, () => void> = {
    summary: () =>
      downloadCsv(
        `tax-summary-${period}.csv`,
        ["Metric", "Amount"],
        [
          ["Outward taxable", paiseToRupeeStr(gstr3b.outwardTaxablePaise)],
          ["Output tax", paiseToRupeeStr(gstr3b.outputTotalPaise)],
          ["Eligible ITC", paiseToRupeeStr(gstr3b.itcTotalPaise)],
          ["Net payable", paiseToRupeeStr(gstr3b.netPayablePaise)],
          ["Credit c/f", paiseToRupeeStr(gstr3b.creditCarryPaise)],
        ],
      ),
    hsn: () =>
      downloadCsv(
        `tax-hsn-${period}.csv`,
        ["HSN", "Rate", "Qty", "Taxable", "CGST", "SGST", "IGST"],
        gstr1.hsn.map((r) => [r.hsn, r.rate, r.qty, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.cgstPaise), paiseToRupeeStr(r.sgstPaise), paiseToRupeeStr(r.igstPaise)]),
      ),
    rates: () => exportRates(`tax-output-by-rate-${period}.csv`, outputByRate),
    itc: () => exportRates(`tax-itc-by-rate-${period}.csv`, itcByRate),
  };

  function exportRates(filename: string, rows: RateAgg[]) {
    downloadCsv(
      filename,
      ["Rate", "Taxable", "CGST", "SGST", "IGST", "Tax"],
      rows.map((r) => [r.rate, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.cgstPaise), paiseToRupeeStr(r.sgstPaise), paiseToRupeeStr(r.igstPaise), paiseToRupeeStr(r.taxPaise)]),
    );
  }

  const hasData = gstr1.invoiceCount > 0 || gstr3b.purchaseCount > 0;

  return (
    <Page width="lg">
      <PageHeader
        icon={Receipt}
        title="Tax reports"
        subtitle={<span>{shop?.name ?? "This shop"} · GST preview</span>}
        actions={
          <>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-[10.5rem]" aria-label="Tax period" />
            <ExportButton onExport={exporters[view]} disabled={!hasData} />
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Tax reports are per shop GSTIN. Pick a shop to continue." />
      ) : !loading && !hasData ? (
        <EmptyState title="No GST activity this period" hint={`No placed sales or received purchases for ${period}.`} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Output tax" value={formatPaise(gstr3b.outputTotalPaise)} hint={`${gstr1.invoiceCount} invoices`} />
            <StatCard label="Eligible ITC" value={formatPaise(gstr3b.itcTotalPaise)} hint={`${gstr3b.purchaseCount} purchase lines`} />
            <StatCard
              label="Net payable"
              value={formatPaise(gstr3b.netPayablePaise)}
              tone={gstr3b.netPayablePaise > 0 ? "danger" : "success"}
              hint={gstr3b.creditCarryPaise > 0 ? `${formatPaise(gstr3b.creditCarryPaise)} credit c/f` : "after set-off"}
            />
            <StatCard label="Outward taxable" value={formatPaise(gstr3b.outwardTaxablePaise)} />
          </div>

          <ViewTabs views={VIEWS} value={view} onChange={setView} />

          {view === "summary" && (
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard
                  title="GSTR-1 · outward supplies"
                  rows={[
                    ["Taxable value", formatPaise(gstr1.totals.taxablePaise)],
                    ["CGST", formatPaise(gstr1.totals.cgstPaise)],
                    ["SGST", formatPaise(gstr1.totals.sgstPaise)],
                    ["IGST", formatPaise(gstr1.totals.igstPaise)],
                    ["B2B parties", String(gstr1.b2b.length)],
                  ]}
                  onOpen={() => navigate("/gst")}
                />
                <SummaryCard
                  title="GSTR-3B · output − ITC"
                  rows={[
                    ["Output tax", formatPaise(gstr3b.outputTotalPaise)],
                    ["Eligible ITC", formatPaise(gstr3b.itcTotalPaise)],
                    ["Net payable", formatPaise(gstr3b.netPayablePaise)],
                    ["Credit c/f", formatPaise(gstr3b.creditCarryPaise)],
                  ]}
                  onOpen={() => navigate("/gst/gstr3b")}
                />
              </div>
              <p className="text-xs text-text-tertiary">
                A preview from posted sales + purchases. File from GST &amp; compliance — those screens build the GSTN JSON /
                CSV and carry the B2B / B2C / HSN detail. GSTR-2B matching lives there too (not yet built).
              </p>
            </div>
          )}

          {view === "hsn" && (
            <DataTable
              cols="1fr 0.7fr 0.7fr 1fr 0.9fr 0.9fr 0.9fr"
              rows={gstr1.hsn}
              rowKey={(r) => `${r.hsn}|${r.rate}`}
              loading={loading}
              empty={<EmptyState title="No lines this period" />}
              columns={[
                { key: "hsn", header: "HSN", cell: (r) => <span className="tabular-nums">{r.hsn}</span> },
                { key: "rate", header: "Rate", numeric: true, cell: (r) => pct(r.rate) },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
                { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
                { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
              ]}
            />
          )}

          {(view === "rates" || view === "itc") && (
            <RateTable rows={view === "rates" ? outputByRate : itcByRate} loading={loading} kind={view === "rates" ? "Output tax" : "ITC"} />
          )}

          <p className="text-xs text-text-tertiary">
            Operational invoices for {period} (IST). Output tax from placed sales; ITC from received purchase lines.
          </p>
        </div>
      )}
    </Page>
  );
}

function SummaryCard({ title, rows, onOpen }: { title: string; rows: [string, string][]; onOpen: () => void }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <h2 className="text-sm font-semibold text-text-secondary">{title}</h2>
        <Button variant="ghost" size="xs" onClick={onOpen}>
          Open <ExternalLink />
        </Button>
      </div>
      <div className="divide-y divide-divider">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-text-secondary">{label}</span>
            <span className="tabular-nums text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RateTable({ rows, loading, kind }: { rows: RateAgg[]; loading: boolean; kind: string }) {
  return (
    <DataTable
      cols="0.8fr 1fr 0.9fr 0.9fr 0.9fr 1fr"
      rows={rows}
      rowKey={(r) => String(r.rate)}
      loading={loading}
      empty={<EmptyState title="Nothing this period" hint={`${kind} broken down by GST rate appears here.`} />}
      columns={[
        { key: "rate", header: "Rate", cell: (r) => pct(r.rate) },
        { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
        { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
        { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
        { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
        { key: "tax", header: kind, numeric: true, cell: (r) => formatPaise(r.taxPaise) },
      ]}
    />
  );
}
