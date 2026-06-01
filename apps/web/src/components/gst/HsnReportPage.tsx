import { useEffect, useMemo, useState } from "react";
import { Boxes, Download } from "lucide-react";

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
import { buildHsnSummary, hsnSummaryToCsv, shiftPeriod, type HsnLineInput, type HsnRow } from "@/lib/gst";

const LINE_COLS = "qty,gst_rate,taxable_paise,cgst_paise,sgst_paise,igst_paise,items(hsn)";

interface LineFetch {
  qty: number;
  gst_rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  items: { hsn: string | null } | null;
}

/** Sale lines for placed bills in [start, end), via their invoices (chunked by invoice id). */
async function fetchHsnLines(orgId: string, shopId: string, start: string, end: string): Promise<HsnLineInput[]> {
  if (!supabase) return [];
  const { data: invs } = await supabase
    .from("sales_invoices")
    .select("id")
    .eq("org_id", orgId)
    .eq("shop_id", shopId)
    .eq("status", "placed")
    .eq("posts_effects", true)
    .gte("invoice_date", start)
    .lt("invoice_date", end);
  const ids = ((invs as { id: string }[] | null) ?? []).map((i) => i.id);
  const out: HsnLineInput[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from("sale_lines").select(LINE_COLS).in("invoice_id", ids.slice(i, i + 300));
    for (const r of (data as unknown as LineFetch[] | null) ?? []) {
      out.push({
        hsn: r.items?.hsn ?? null,
        gst_rate: r.gst_rate,
        qty: r.qty,
        taxable_paise: r.taxable_paise,
        cgst_paise: r.cgst_paise,
        sgst_paise: r.sgst_paise,
        igst_paise: r.igst_paise,
      });
    }
  }
  return out;
}

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function HsnReportPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const thisMonth = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(thisMonth);
  const [lines, setLines] = useState<HsnLineInput[]>([]);
  const [loading, setLoading] = useState(true);

  // Normalise so from <= to regardless of which the user set.
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const start = `${lo}-01`;
  const end = `${shiftPeriod(hi, 1)}-01`;

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    (async () => {
      setLoading(true);
      const ls = await fetchHsnLines(orgId, shopId, start, end);
      if (!active) return;
      setLines(ls);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, start, end]);

  const summary = useMemo(() => buildHsnSummary(lines), [lines]);
  const hasData = summary.rows.length > 0;
  const totalTax = summary.totals.cgstPaise + summary.totals.sgstPaise + summary.totals.igstPaise;

  return (
    <Page width="lg">
      <PageHeader
        icon={Boxes}
        title="HSN-wise summary"
        subtitle={<span>{shop?.name ?? "This shop"} · outward supplies by HSN × rate (GSTR-1 §12 / GSTR-9)</span>}
        actions={
          <>
            <Input type="month" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-[8.5rem]" aria-label="From month" />
            <span className="text-text-tertiary">→</span>
            <Input type="month" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-[8.5rem]" aria-label="To month" />
            <Button variant="outline" disabled={!hasData} onClick={() => download(`hsn-${lo}_${hi}.csv`, hsnSummaryToCsv(summary), "text/csv")}>
              <Download /> CSV
            </Button>
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Pick a shop to summarise its HSN supplies." />
      ) : !loading && !hasData ? (
        <EmptyState title="No sales in range" hint={`No placed invoices from ${lo} to ${hi}.`} />
      ) : (
        <div className="flex flex-col gap-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="HSN × rate rows" value={summary.rows.length} />
            <StatCard label="Total qty" value={summary.qty} />
            <StatCard label="Taxable value" value={formatPaise(summary.totals.taxablePaise)} />
            <StatCard label="Total tax" value={formatPaise(totalTax)} />
          </div>

          <DataTable<HsnRow>
            cols="1.1fr 0.7fr 0.7fr 1fr 0.9fr 0.9fr 0.9fr"
            rows={summary.rows}
            rowKey={(r) => `${r.hsn}|${r.rate}`}
            loading={loading}
            columns={[
              { key: "hsn", header: "HSN", cell: (r) => <span className="tabular-nums">{r.hsn}</span> },
              { key: "rate", header: "Rate", numeric: true, cell: (r) => `${r.rate}%` },
              { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
              { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
              { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
              { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
              { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
            ]}
          />
        </div>
      )}
    </Page>
  );
}
