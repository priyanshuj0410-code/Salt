import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Contact, HandCoins, Pencil, Plus } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RangeControls, ViewTabs, ExportButton, type ReportView } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { presetRange, downloadCsv, paiseToRupeeStr } from "@/lib/reports";
import {
  getSalesman,
  listSalesmanInvoices,
  listSalesmanCollections,
  toDraft,
  type Salesman,
  type SalesmanDraft,
  type SalesmanInvoice,
  type SalesmanCollection,
} from "@/lib/salesmen";
import { SalesmanForm } from "./SalesmanForm";
import { AttributeDialog } from "./AttributeDialog";

type ViewKey = "orders" | "collections";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "orders", label: "Orders" },
  { key: "collections", label: "Collections" },
];

const fmtDate = (d: string) => format(parseISO(d), "d MMM yyyy");

/** Salesmen → one salesman. Period performance + their orders and collections. */
export function SalesmanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();

  const [salesman, setSalesman] = useState<Salesman | null>(null);
  const [invoices, setInvoices] = useState<SalesmanInvoice[]>([]);
  const [collections, setCollections] = useState<SalesmanCollection[]>([]);
  const [range, setRange] = useState(() => presetRange("month"));
  const [view, setView] = useState<ViewKey>("orders");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalesmanDraft | null>(null);
  const [attributing, setAttributing] = useState<ViewKey | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orgId || !id) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sm, inv, col] = await Promise.all([
          getSalesman(orgId, id),
          listSalesmanInvoices(orgId, id, range.from, range.to),
          listSalesmanCollections(orgId, id, range.from, range.to),
        ]);
        if (!active) return;
        setSalesman(sm);
        setInvoices(inv);
        setCollections(col);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load salesman.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, id, range.from, range.to, reloadKey]);

  const perf = useMemo(() => {
    const placed = invoices.filter((i) => i.status !== "cancelled");
    const netSales = placed.reduce((s, i) => s + (i.taxable_paise ?? 0), 0);
    const pct = salesman?.commission_pct ?? 0;
    return {
      orders: placed.length,
      netSales,
      commission: Math.round((pct / 100) * netSales),
      collections: collections.reduce((s, c) => s + (c.amount_paise ?? 0), 0),
    };
  }, [invoices, collections, salesman]);

  function exportCsv() {
    if (view === "orders") {
      downloadCsv(
        `${salesman?.name ?? "salesman"}_orders_${range.from}_${range.to}.csv`,
        ["Invoice", "Date", "Party", "Status", "Net (taxable)", "Total", "Paid"],
        invoices.map((i) => [
          i.invoice_no ?? "",
          i.invoice_date,
          i.ledgers?.name ?? "Walk-in",
          i.status,
          paiseToRupeeStr(i.taxable_paise),
          paiseToRupeeStr(i.total_paise),
          paiseToRupeeStr(i.paid_paise),
        ]),
      );
    } else {
      downloadCsv(
        `${salesman?.name ?? "salesman"}_collections_${range.from}_${range.to}.csv`,
        ["Date", "Party", "Mode", "Reference", "Amount"],
        collections.map((c) => [
          c.payment_date,
          c.ledgers?.name ?? "",
          c.mode,
          c.reference ?? "",
          paiseToRupeeStr(c.amount_paise),
        ]),
      );
    }
  }

  if (!loading && !salesman) {
    return (
      <Page width="lg">
        <PageHeader icon={Contact} title="Salesman not found" />
        <Button variant="outline" onClick={() => navigate("/salesmen")}>
          <ArrowLeft /> Back to salesmen
        </Button>
      </Page>
    );
  }

  const subtitleBits = salesman
    ? [salesman.territory, salesman.phone, salesman.commission_pct ? `${salesman.commission_pct}% commission` : null].filter(
        Boolean,
      )
    : [];

  return (
    <Page width="lg">
      <PageHeader
        icon={Contact}
        title={
          <span className="inline-flex items-center gap-2">
            {salesman?.name ?? "…"}
            {salesman && !salesman.is_active && <Badge variant="neutral">Inactive</Badge>}
          </span>
        }
        subtitle={subtitleBits.length > 0 ? subtitleBits.join(" · ") : "Field salesman"}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate("/salesmen")}>
              <ArrowLeft /> All salesmen
            </Button>
            {salesman && (
              <Button variant="outline" onClick={() => setEditing(toDraft(salesman))}>
                <Pencil /> Edit
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <RangeControls from={range.from} to={range.to} onChange={setRange} />
      </div>

      {error && <p className="mb-4 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Orders" value={<span className="tabular-nums">{perf.orders}</span>} hint="Placed invoices" />
        <StatCard label="Net sales" value={formatPaise(perf.netSales)} hint="Ex-GST taxable value" />
        <StatCard
          label="Commission"
          value={formatPaise(perf.commission)}
          hint={salesman?.commission_pct ? `${salesman.commission_pct}% of net sales` : "No rate set"}
        />
        <StatCard label="Collections" value={formatPaise(perf.collections)} tone="success" hint="Received in period" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ViewTabs views={VIEWS} value={view} onChange={setView} />
        <div className="flex items-center gap-2">
          {view === "orders" ? (
            <Button variant="outline" size="sm" onClick={() => setAttributing("orders")} disabled={!orgId}>
              <Plus /> Attribute orders
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAttributing("collections")} disabled={!orgId}>
              <HandCoins /> Attribute collections
            </Button>
          )}
          <ExportButton onExport={exportCsv} disabled={view === "orders" ? invoices.length === 0 : collections.length === 0} />
        </div>
      </div>

      {view === "orders" ? (
        <DataTable<SalesmanInvoice>
          rows={invoices}
          rowKey={(i) => i.id}
          cols="1fr 0.9fr 1.4fr 0.8fr 1fr 1fr"
          loading={loading}
          empty={
            <EmptyState
              icon={Contact}
              title="No orders in this period"
              hint="Orders get attributed to a salesman at billing, or assign existing ones with “Attribute orders”."
            />
          }
          columns={[
            { key: "invoice_no", header: "Invoice", cell: (i) => i.invoice_no ?? <span className="text-text-tertiary">—</span> },
            { key: "date", header: "Date", cell: (i) => <span className="text-text-secondary">{fmtDate(i.invoice_date)}</span> },
            { key: "party", header: "Party", cell: (i) => i.ledgers?.name ?? <span className="text-text-tertiary">Walk-in</span> },
            {
              key: "status",
              header: "Status",
              cell: (i) => <Badge variant={i.status === "cancelled" ? "danger" : "neutral"}>{i.status}</Badge>,
            },
            { key: "taxable", header: "Net sales", numeric: true, cell: (i) => formatPaise(i.taxable_paise) },
            { key: "total", header: "Total", numeric: true, cell: (i) => formatPaise(i.total_paise) },
          ]}
        />
      ) : (
        <DataTable<SalesmanCollection>
          rows={collections}
          rowKey={(c) => c.id}
          cols="0.9fr 1.6fr 0.8fr 1.2fr 1fr"
          loading={loading}
          empty={
            <EmptyState
              icon={HandCoins}
              title="No collections in this period"
              hint="Receipts collected by this salesman appear here. Assign existing ones with “Attribute collections”."
            />
          }
          columns={[
            { key: "date", header: "Date", cell: (c) => <span className="text-text-secondary">{fmtDate(c.payment_date)}</span> },
            { key: "party", header: "Party", cell: (c) => c.ledgers?.name ?? <span className="text-text-tertiary">—</span> },
            { key: "mode", header: "Mode", cell: (c) => <span className="uppercase text-text-secondary">{c.mode}</span> },
            { key: "reference", header: "Reference", cell: (c) => c.reference ?? <span className="text-text-tertiary">—</span> },
            { key: "amount", header: "Amount", numeric: true, cell: (c) => <span className="text-success">{formatPaise(c.amount_paise)}</span> },
          ]}
        />
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <SalesmanForm
              key={editing.id ?? "new"}
              initial={editing}
              orgId={orgId}
              onDone={(deleted) => {
                setEditing(null);
                // A delete leaves no salesman to show — bounce to the list.
                if (deleted) navigate("/salesmen");
                else setReloadKey((k) => k + 1);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {salesman && (
        <AttributeDialog
          kind={attributing ?? "orders"}
          salesmanId={salesman.id}
          salesmanName={salesman.name}
          orgId={orgId}
          open={attributing != null}
          onOpenChange={(o) => !o && setAttributing(null)}
          onDone={() => setReloadKey((k) => k + 1)}
        />
      )}
    </Page>
  );
}
