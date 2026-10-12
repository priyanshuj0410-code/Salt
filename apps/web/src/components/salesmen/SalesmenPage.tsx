import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Contact, Plus } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/ui/dot";
import { RangeControls, ExportButton } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { formatPaise, formatPaiseCompact } from "@/lib/currency";
import { presetRange, downloadCsv, paiseToRupeeStr } from "@/lib/reports";
import {
  listSalesmen,
  fetchPerf,
  BLANK_SALESMAN,
  type Salesman,
  type SalesmanDraft,
  type SalesmanPerf,
} from "@/lib/salesmen";
import { SalesmanForm } from "./SalesmanForm";

const ZERO: SalesmanPerf = {
  orders: 0,
  netSalesPaise: 0,
  grossSalesPaise: 0,
  commissionPaise: 0,
  collectionsPaise: 0,
};

/**
 * Salesmen → master list. One row per salesman with their performance for the
 * chosen period (orders, net sales, commission due, collections) — this is both
 * the master and the salesman-wise commission report. Click a row to drill in.
 */
export function SalesmenPage() {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();

  const [rows, setRows] = useState<Salesman[]>([]);
  const [perf, setPerf] = useState<Map<string, SalesmanPerf>>(new Map());
  const [range, setRange] = useState(() => presetRange("month"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalesmanDraft | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const salesmen = await listSalesmen(orgId);
        if (!active) return;
        setRows(salesmen);
        const p = await fetchPerf(orgId, range.from, range.to, salesmen);
        if (active) setPerf(p);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load salesmen.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, range.from, range.to, reloadKey]);

  const totals = useMemo(() => {
    let net = 0;
    let commission = 0;
    let collections = 0;
    let orders = 0;
    for (const p of perf.values()) {
      net += p.netSalesPaise;
      commission += p.commissionPaise;
      collections += p.collectionsPaise;
      orders += p.orders;
    }
    const active = rows.filter((r) => r.is_active).length;
    return { net, commission, collections, orders, active };
  }, [perf, rows]);

  function exportCsv() {
    downloadCsv(
      `salesmen_${range.from}_${range.to}.csv`,
      ["Salesman", "Territory", "Mobile", "Commission %", "Orders", "Net sales", "Commission", "Collections", "Active"],
      rows.map((s) => {
        const p = perf.get(s.id) ?? ZERO;
        return [
          s.name,
          s.territory ?? "",
          s.phone ?? "",
          s.commission_pct,
          p.orders,
          paiseToRupeeStr(p.netSalesPaise),
          paiseToRupeeStr(p.commissionPaise),
          paiseToRupeeStr(p.collectionsPaise),
          s.is_active ? "yes" : "no",
        ];
      }),
    );
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={Contact}
        title="Salesmen"
        subtitle={
          rows.length > 0
            ? `${totals.active} active · ${rows.length} total`
            : "Field salesmen: orders, commission and collections"
        }
        actions={
          <Button onClick={() => setEditing(BLANK_SALESMAN)} disabled={!orgId}>
            <Plus /> Add salesman
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <RangeControls from={range.from} to={range.to} onChange={setRange} />
        <ExportButton onExport={exportCsv} disabled={rows.length === 0} />
      </div>

      {error && (
        <p className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Orders" value={<span className="tabular-nums">{totals.orders}</span>} hint="In the period" />
        <StatCard label="Net sales" value={formatPaiseCompact(totals.net)} valueTitle={formatPaise(totals.net)} hint="Ex-GST, attributed" />
        <StatCard label="Commission" value={formatPaiseCompact(totals.commission)} valueTitle={formatPaise(totals.commission)} hint="Earned in period" />
        <StatCard label="Collections" value={formatPaiseCompact(totals.collections)} valueTitle={formatPaise(totals.collections)} tone="success" hint="Received in period" />
      </div>

      <DataTable<Salesman>
        rows={rows}
        rowKey={(s) => s.id}
        cols="1.6fr 0.7fr 0.6fr 1fr 1fr 1fr 0.8fr"
        onRowActivate={(s) => navigate(`/salesmen/${s.id}`)}
        loading={loading}
        empty={
          <EmptyState
            icon={Contact}
            title="No salesmen yet"
            hint="Add your field salesmen to track orders, commission and the receivables they collect."
            action={
              <Button size="sm" onClick={() => setEditing(BLANK_SALESMAN)} disabled={!orgId}>
                <Plus /> Add salesman
              </Button>
            }
          />
        }
        columns={[
          {
            key: "name",
            header: "Salesman",
            cell: (s) => (
              <>
                <span className="font-medium">{s.name}</span>
                {(s.territory || s.phone) && (
                  <span className="ml-1.5 text-xs text-text-tertiary">
                    {[s.territory, s.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </>
            ),
          },
          {
            key: "commission_pct",
            header: "Comm %",
            numeric: true,
            cell: (s) => <span className="text-text-secondary">{s.commission_pct ? `${s.commission_pct}%` : "-"}</span>,
          },
          { key: "orders", header: "Orders", numeric: true, cell: (s) => (perf.get(s.id)?.orders ?? 0) || <span className="text-text-tertiary">0</span> },
          { key: "net", header: "Net sales", numeric: true, cell: (s) => formatPaise(perf.get(s.id)?.netSalesPaise ?? 0) },
          { key: "commission", header: "Commission", numeric: true, cell: (s) => formatPaise(perf.get(s.id)?.commissionPaise ?? 0) },
          {
            key: "collections",
            header: "Collections",
            numeric: true,
            cell: (s) => {
              const v = perf.get(s.id)?.collectionsPaise ?? 0;
              return <span className={v > 0 ? "text-success" : undefined}>{formatPaise(v)}</span>;
            },
          },
          {
            key: "status",
            header: "Status",
            cell: (s) => (
              <span className="inline-flex items-center gap-1.5">
                <Dot variant={s.is_active ? "success" : "neutral"} />
                <Badge variant={s.is_active ? "success" : "neutral"}>{s.is_active ? "Active" : "Inactive"}</Badge>
              </span>
            ),
          },
        ]}
      />

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <SalesmanForm
              key={editing.id ?? "new"}
              initial={editing}
              orgId={orgId}
              onDone={() => {
                setEditing(null);
                setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
