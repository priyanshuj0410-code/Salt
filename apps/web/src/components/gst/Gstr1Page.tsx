import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Landmark, Download } from "lucide-react";

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
import {
  buildGstr1,
  buildGstr1Json,
  gstr1ToCsv,
  type Gstr1InvoiceRow,
  type Gstr1LineRow,
  type B2bParty,
  type B2csRow,
  type B2clInvoice,
  type HsnRow,
} from "@/lib/gst";

/** Raw `sales_invoices` shape from PostgREST (party embedded as `ledgers`). */
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

/** Raw `sale_lines` shape from PostgREST (HSN embedded via `items`). */
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

const INVOICE_COLS =
  "id,invoice_no,invoice_date,is_interstate,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,ledgers(gstin,name,state_code)";
const LINE_COLS = "invoice_id,qty,gst_rate,taxable_paise,cgst_paise,sgst_paise,igst_paise,items(hsn)";

/** Fetch sale_lines for many invoice ids, chunked to keep the URL bounded. */
async function fetchLines(invoiceIds: string[]): Promise<Gstr1LineRow[]> {
  if (!supabase || invoiceIds.length === 0) return [];
  const out: Gstr1LineRow[] = [];
  for (let i = 0; i < invoiceIds.length; i += 300) {
    const { data } = await supabase
      .from("sale_lines")
      .select(LINE_COLS)
      .in("invoice_id", invoiceIds.slice(i, i + 300));
    for (const r of (data as unknown as LineFetch[] | null) ?? []) {
      out.push({ ...r, hsn: r.items?.hsn ?? null });
    }
  }
  return out;
}

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

const pct = (rate: number) => `${rate}%`;

export function Gstr1Page() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
  const [invoices, setInvoices] = useState<Gstr1InvoiceRow[]>([]);
  const [lines, setLines] = useState<Gstr1LineRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const [y, m] = period.split("-").map(Number);
    const start = `${period}-01`;
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // first day of next month

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("sales_invoices")
        .select(INVOICE_COLS)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "placed")
        .eq("posts_effects", true) // exclude imported pre-cutover history (already filed elsewhere)
        .gte("invoice_date", start)
        .lt("invoice_date", end)
        .order("invoice_date");
      if (!active) return;
      const invs = ((data as unknown as InvoiceFetch[] | null) ?? []).map(
        (r): Gstr1InvoiceRow => ({ ...r, party: r.ledgers }),
      );
      const ls = await fetchLines(invs.map((i) => i.id));
      if (!active) return;
      setInvoices(invs);
      setLines(ls);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopId, period]);

  const summary = useMemo(
    () => buildGstr1(period, shop?.state_code ?? "", invoices, lines),
    [period, shop?.state_code, invoices, lines],
  );

  const hasData = summary.invoiceCount > 0;
  const filerGstin = shop?.gstin ?? "";

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
        icon={Landmark}
        title="GSTR-1 — outward supplies"
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
              onClick={() => download(`gstr1-${filerGstin || "shop"}-${period}.json`, JSON.stringify(buildGstr1Json(summary, filerGstin), null, 2), "application/json")}
            >
              <Download /> JSON
            </Button>
            <Button
              variant="outline"
              disabled={!hasData}
              onClick={() => download(`gstr1-${period}.csv`, gstr1ToCsv(summary), "text/csv")}
            >
              <Download /> CSV
            </Button>
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="GSTR-1 is filed per shop GSTIN. Pick a shop to continue." />
      ) : !loading && !hasData ? (
        <EmptyState
          title="No sales this period"
          hint={`No placed invoices for ${period}. Pick another month, or record sales at the counter.`}
        />
      ) : (
        <div className="flex flex-col gap-7">
          <div hidden={!hasData} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Taxable value" value={formatPaise(summary.totals.taxablePaise)} />
            <StatCard label="CGST" value={formatPaise(summary.totals.cgstPaise)} />
            <StatCard label="SGST" value={formatPaise(summary.totals.sgstPaise)} />
            <StatCard label="IGST" value={formatPaise(summary.totals.igstPaise)} />
            <StatCard label="Invoices" value={summary.invoiceCount} hint={`${summary.hsn.length} HSN × rate rows`} />
          </div>

          <Section title="B2B — registered recipients" count={summary.b2b.length}>
            <DataTable<B2bParty>
              cols="1.5fr 1.6fr 0.7fr 1fr 0.9fr 0.9fr 0.9fr"
              rows={summary.b2b}
              rowKey={(r) => r.gstin}
              loading={loading}
              empty="No B2B sales (no recipient had a GSTIN)."
              columns={[
                { key: "gstin", header: "GSTIN", cell: (r) => <span className="tabular-nums">{r.gstin}</span> },
                { key: "name", header: "Party", cell: (r) => r.name || "—" },
                { key: "inv", header: "Invoices", numeric: true, cell: (r) => r.invoices.length },
                { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
                { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
                { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
              ]}
            />
          </Section>

          <Section title="B2C (small) — by place of supply & rate" count={summary.b2cs.length}>
            <DataTable<B2csRow>
              cols="0.8fr 0.8fr 0.7fr 1fr 0.9fr 0.9fr 0.9fr"
              rows={summary.b2cs}
              rowKey={(r) => `${r.pos}|${r.supplyType}|${r.rate}`}
              loading={loading}
              empty="No B2C sales this period."
              columns={[
                { key: "pos", header: "POS", cell: (r) => <span className="tabular-nums">{r.pos || "—"}</span> },
                { key: "type", header: "Supply", cell: (r) => r.supplyType },
                { key: "rate", header: "Rate", numeric: true, cell: (r) => pct(r.rate) },
                { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "cgst", header: "CGST", numeric: true, cell: (r) => formatPaise(r.cgstPaise) },
                { key: "sgst", header: "SGST", numeric: true, cell: (r) => formatPaise(r.sgstPaise) },
                { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
              ]}
            />
          </Section>

          {summary.b2cl.length > 0 && (
            <Section title="B2C (large) — inter-state invoices ≥ ₹2.5L" count={summary.b2cl.length}>
              <DataTable<B2clInvoice>
                cols="1.2fr 0.7fr 1fr 1fr 1fr 1fr"
                rows={summary.b2cl}
                rowKey={(r) => r.invoiceNo}
                loading={loading}
                columns={[
                  { key: "inv", header: "Invoice", cell: (r) => <span className="tabular-nums">{r.invoiceNo}</span> },
                  { key: "pos", header: "POS", cell: (r) => <span className="tabular-nums">{r.pos || "—"}</span> },
                  { key: "date", header: "Date", cell: (r) => r.date },
                  { key: "tax", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                  { key: "igst", header: "IGST", numeric: true, cell: (r) => formatPaise(r.igstPaise) },
                  { key: "total", header: "Invoice value", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
                ]}
              />
            </Section>
          )}

          <Section title="HSN summary" count={summary.hsn.length}>
            <DataTable<HsnRow>
              cols="1fr 0.7fr 0.7fr 1fr 0.9fr 0.9fr 0.9fr"
              rows={summary.hsn}
              rowKey={(r) => `${r.hsn}|${r.rate}`}
              loading={loading}
              empty="No lines this period."
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
          </Section>
        </div>
      )}
    </Page>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text-secondary">
        {title} <span className="ml-1 font-normal text-text-tertiary">({count})</span>
      </h2>
      {children}
    </section>
  );
}
