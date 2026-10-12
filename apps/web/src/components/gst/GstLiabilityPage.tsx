import { useEffect, useMemo, useState } from "react";
import { Gauge, ArrowUp, ArrowDown, Minus } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise, formatSigned, formatPaiseCompact } from "@/lib/currency";
import { buildGstLiability, shiftPeriod, type DatedTaxRow, type LiabilityDelta } from "@/lib/gst";

const TAX_COLS = "cgst_paise,sgst_paise,igst_paise";

interface SalesFetch {
  invoice_date: string;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}
interface PurchaseFetch {
  received_date: string;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
}

/** A short, friendly month label, e.g. 2026-06 → "Jun 26". */
function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${String(y).slice(2)}`;
}

function Delta({ label, d }: { label: string; d: LiabilityDelta }) {
  if (!d.prev) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary">no prior data</span>
      </div>
    );
  }
  const Icon = d.deltaPaise === 0 ? Minus : d.deltaPaise > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">
        {label} <span className="text-text-tertiary">vs {monthLabel(d.prev.period)}</span>
      </span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Icon className="size-3.5 text-text-tertiary" />
        {formatSigned(d.deltaPaise)}
        {d.pct != null && (
          <span className="text-text-tertiary">
            ({d.pct > 0 ? "+" : ""}
            {d.pct.toFixed(0)}%)
          </span>
        )}
      </span>
    </div>
  );
}

export function GstLiabilityPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const period = useMemo(() => new Date().toISOString().slice(0, 7), []); // current 'YYYY-MM'
  const [nowMs] = useState(() => Date.now()); // captured once (clock reads belong outside render)
  const [sales, setSales] = useState<DatedTaxRow[]>([]);
  const [purchases, setPurchases] = useState<DatedTaxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const start = `${shiftPeriod(period, -12)}-01`; // 13-month window incl. YoY month
    const end = `${shiftPeriod(period, 1)}-01`; // first day of next month
    (async () => {
      setLoading(true);
      const salesQ = supabase
        .from("sales_invoices")
        .select(`invoice_date,${TAX_COLS}`)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "placed")
        .eq("posts_effects", true)
        .gte("invoice_date", start)
        .lt("invoice_date", end);
      const purchasesQ = supabase
        .from("purchases")
        .select(`received_date,${TAX_COLS}`)
        .eq("org_id", orgId)
        .eq("shop_id", shopId)
        .eq("status", "received")
        .eq("posts_effects", true)
        .gte("received_date", start)
        .lt("received_date", end);
      const [s, p] = await Promise.all([salesQ, purchasesQ]);
      if (!active) return;
      setSales(
        ((s.data as unknown as SalesFetch[] | null) ?? []).map((r) => ({
          date: r.invoice_date,
          cgst_paise: r.cgst_paise,
          sgst_paise: r.sgst_paise,
          igst_paise: r.igst_paise,
        })),
      );
      setPurchases(
        ((p.data as unknown as PurchaseFetch[] | null) ?? []).map((r) => ({
          date: r.received_date,
          cgst_paise: r.cgst_paise,
          sgst_paise: r.sgst_paise,
          igst_paise: r.igst_paise,
        })),
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, period]);

  const view = useMemo(() => buildGstLiability(period, sales, purchases, 13), [period, sales, purchases]);
  const hasData = view.series.some((m) => m.outputPaise > 0 || m.itcPaise > 0);

  const daysLeft = Math.ceil((new Date(`${view.dueDate}T00:00:00`).getTime() - nowMs) / 86_400_000);
  const maxNet = view.series.reduce((mx, m) => (m.netPayablePaise > mx ? m.netPayablePaise : mx), 1);

  const subtitle = (
    <span>
      {shop?.name ?? "This shop"} · {monthLabel(period)} ·{" "}
      {shop?.gstin ? (
        <span className="tabular-nums">{shop.gstin}</span>
      ) : (
        <span className="text-warning">no GSTIN set: set it in Settings before filing</span>
      )}
    </span>
  );

  return (
    <Page width="lg">
      <PageHeader icon={Gauge} title="GST liability" subtitle={subtitle} />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="GST liability is per shop GSTIN. Pick a shop to continue." />
      ) : !loading && !hasData ? (
        <EmptyState title="No GST activity yet" hint="Record sales or purchases and your monthly tax position will show here." />
      ) : (
        <div className="flex flex-col gap-7">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Output tax" value={formatPaiseCompact(view.current.outputPaise)} valueTitle={formatPaise(view.current.outputPaise)} hint="on this month's sales" />
            <StatCard label="Eligible ITC" value={formatPaiseCompact(view.current.itcPaise)} valueTitle={formatPaise(view.current.itcPaise)} hint="on this month's purchases" />
            <StatCard
              label="Net payable"
              value={formatPaiseCompact(view.current.netPayablePaise)} valueTitle={formatPaise(view.current.netPayablePaise)}
              tone={view.current.netPayablePaise > 0 ? "danger" : "success"}
              hint={view.current.netPaise < 0 ? `${formatPaise(-view.current.netPaise)} credit c/f` : "after full set-off"}
            />
            <StatCard
              label="Payment due"
              value={new Date(`${view.dueDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              tone={daysLeft < 0 ? "danger" : "default"}
              hint={daysLeft < 0 ? `${-daysLeft} days overdue` : `${daysLeft} days left · GSTR-3B`}
            />
          </div>

          <section className="grid gap-2 rounded-lg border border-border bg-surface p-4 sm:max-w-md">
            <h2 className="text-sm font-semibold text-text-secondary">Net payable trend</h2>
            <Delta label="Month on month" d={view.mom} />
            <Delta label="Year on year" d={view.yoy} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-text-secondary">Last 13 months: net payable</h2>
            <div className="flex h-40 items-end gap-1.5">
              {view.series.map((m, i) => {
                const isCurrent = i === view.series.length - 1;
                const h = (m.netPayablePaise / maxNet) * 100;
                return (
                  <div
                    key={m.period}
                    className={`flex-1 rounded-t ${isCurrent ? "bg-primary" : "bg-text-tertiary/35"}`}
                    style={{ height: `${m.netPayablePaise > 0 ? Math.max(h, 3) : 0.5}%` }}
                    title={`${monthLabel(m.period)}: ${formatPaise(m.netPayablePaise)}`}
                  />
                );
              })}
            </div>
            <div className="mt-1 flex gap-1.5">
              {view.series.map((m) => (
                <span key={m.period} className="flex-1 text-center text-[0.6rem] text-text-tertiary tabular-nums">
                  {m.period.slice(5)}
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
