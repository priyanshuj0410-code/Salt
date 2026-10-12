import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ViewTabs, RangeControls, ExportButton, ShopSelect, type ReportView } from "@/components/reports/report-controls";
import { useOrgShops, scopeLabelFor, ALL_SHOPS } from "@/components/reports/useOrgShops";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { fetchAllPaged } from "@/lib/reportData";
import {
  presetRange,
  rollupLines,
  rollupParties,
  sumBy,
  downloadCsv,
  paiseToRupeeStr,
  type LineGroup,
  type PartyGroup,
} from "@/lib/reports";

interface SalesInvoiceRow {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  party_id: string | null;
  payment_method: string | null;
  status: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  paid_paise: number;
  created_by: string | null;
  ledgers: { name: string | null; gstin: string | null } | null;
}

interface SaleLineRow {
  invoice_id: string;
  item_id: string | null;
  name: string;
  qty: number;
  gst_rate: number;
  taxable_paise: number;
  line_total_paise: number;
  items: { schedule: string | null; hsn: string | null } | null;
}

const INV_COLS =
  "id,invoice_no,invoice_date,party_id,payment_method,status,taxable_paise,cgst_paise,sgst_paise,igst_paise,total_paise,paid_paise,created_by,ledgers(name,gstin)";
const LINE_COLS =
  "invoice_id,item_id,name,qty,gst_rate,taxable_paise,line_total_paise,items(schedule,hsn),sales_invoices!inner(invoice_date)";

type ViewKey = "register" | "items" | "categories" | "customers" | "cashiers" | "cancelled";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "register", label: "Daily register" },
  { key: "items", label: "Item-wise" },
  { key: "categories", label: "Categories" },
  { key: "customers", label: "Customers" },
  { key: "cashiers", label: "Cashiers" },
  { key: "cancelled", label: "Cancelled" },
];

const gstOf = (i: SalesInvoiceRow) => i.cgst_paise + i.sgst_paise + i.igst_paise;
const payLabel = (m: string | null) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : "-");

export function SalesReportsPage() {
  const { membership, shop } = useAuth();
  const orgId = membership?.orgId;
  const navigate = useNavigate();
  const { shops } = useOrgShops();
  const [shopFilter, setShopFilter] = useState<string>(ALL_SHOPS);
  const [range, setRange] = useState(() => presetRange("month"));
  const [view, setView] = useState<ViewKey>("register");
  const [invoices, setInvoices] = useState<SalesInvoiceRow[]>([]);
  const [lines, setLines] = useState<SaleLineRow[]>([]);
  const [cashierNames, setCashierNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const db = supabase;
    const { from, to } = range;
    const oneShop = shopFilter === ALL_SHOPS ? null : shopFilter;

    (async () => {
      setLoading(true);
      const [invs, lns] = await Promise.all([
        fetchAllPaged<SalesInvoiceRow>((f, t) => {
          let q = db
            .from("sales_invoices")
            .select(INV_COLS)
            .eq("org_id", orgId)
            .eq("posts_effects", true)
            .in("status", ["placed", "cancelled"])
            .gte("invoice_date", from)
            .lte("invoice_date", to);
          if (oneShop) q = q.eq("shop_id", oneShop);
          return q.order("invoice_date", { ascending: false }).range(f, t);
        }),
        fetchAllPaged<SaleLineRow>((f, t) => {
          let q = db
            .from("sale_lines")
            .select(LINE_COLS)
            .eq("org_id", orgId)
            .eq("sales_invoices.status", "placed")
            .eq("sales_invoices.posts_effects", true)
            .gte("sales_invoices.invoice_date", from)
            .lte("sales_invoices.invoice_date", to);
          if (oneShop) q = q.eq("sales_invoices.shop_id", oneShop);
          return q.range(f, t);
        }),
      ]);
      if (!active) return;
      setInvoices(invs);
      setLines(lns);
      setLoading(false);

      // Resolve cashier display names (best-effort; RLS may hide non-self profiles).
      const ids = Array.from(new Set(invs.map((i) => i.created_by).filter((x): x is string => !!x)));
      if (ids.length > 0) {
        const { data } = await db.from("profiles").select("id,full_name,email").in("id", ids);
        if (!active) return;
        const map: Record<string, string> = {};
        for (const p of (data as { id: string; full_name: string | null; email: string | null }[] | null) ?? []) {
          map[p.id] = p.full_name || p.email || `User ${p.id.slice(0, 8)}`;
        }
        setCashierNames(map);
      } else {
        setCashierNames({});
      }
    })();

    return () => {
      active = false;
    };
  }, [orgId, shopFilter, range]);

  const placed = useMemo(() => invoices.filter((i) => i.status === "placed"), [invoices]);
  const cancelled = useMemo(() => invoices.filter((i) => i.status === "cancelled"), [invoices]);
  const placedDocs = useMemo(() => placed.map((i) => ({ ...i, date: i.invoice_date })), [placed]);

  const totals = useMemo(
    () => ({
      count: placed.length,
      taxable: sumBy(placed, (i) => i.taxable_paise),
      gst: sumBy(placed, gstOf),
      total: sumBy(placed, (i) => i.total_paise),
    }),
    [placed],
  );

  const items = useMemo(
    () => rollupLines(lines, (l) => l.item_id ?? `name:${l.name}`, (l) => l.name || "-"),
    [lines],
  );
  const byRate = useMemo(
    () => rollupLines(lines, (l) => String(l.gst_rate), (l) => `${l.gst_rate}%`),
    [lines],
  );
  const bySchedule = useMemo(
    () => rollupLines(lines, (l) => l.items?.schedule ?? "Unknown", (l) => l.items?.schedule ?? "Unknown"),
    [lines],
  );
  const customers = useMemo(
    () => rollupParties(placedDocs, (i) => i.party_id ?? "walk-in", (i) => i.ledgers?.name ?? "Walk-in"),
    [placedDocs],
  );
  const cashiers = useMemo(
    () =>
      rollupParties(
        placedDocs,
        (i) => i.created_by ?? "unknown",
        (i) => (i.created_by ? cashierNames[i.created_by] ?? `User ${i.created_by.slice(0, 8)}` : "Unknown"),
      ),
    [placedDocs, cashierNames],
  );

  const periodTag = `${range.from}_${range.to}`;
  const exporters: Record<ViewKey, () => void> = {
    register: () =>
      downloadCsv(
        `sales-register-${periodTag}.csv`,
        ["Date", "Invoice", "Party", "Payment", "Taxable", "GST", "Total"],
        placed.map((i) => [
          i.invoice_date,
          i.invoice_no ?? i.id.slice(0, 8),
          i.ledgers?.name ?? "Walk-in",
          payLabel(i.payment_method),
          paiseToRupeeStr(i.taxable_paise),
          paiseToRupeeStr(gstOf(i)),
          paiseToRupeeStr(i.total_paise),
        ]),
      ),
    items: () =>
      downloadCsv(
        `sales-items-${periodTag}.csv`,
        ["Item", "Qty", "Lines", "Taxable", "Total"],
        items.map((r) => [r.label, r.qty, r.lines, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.totalPaise)]),
      ),
    categories: () =>
      downloadCsv(
        `sales-categories-${periodTag}.csv`,
        ["Kind", "Category", "Qty", "Taxable", "Total"],
        [
          ...byRate.map((r) => ["GST rate", r.label, r.qty, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.totalPaise)]),
          ...bySchedule.map((r) => ["Schedule", r.label, r.qty, paiseToRupeeStr(r.taxablePaise), paiseToRupeeStr(r.totalPaise)]),
        ] as (string | number)[][],
      ),
    customers: () =>
      downloadCsv(
        `sales-customers-${periodTag}.csv`,
        ["Customer", "Bills", "Total", "Outstanding", "Last sale"],
        customers.map((c) => [c.name, c.docs, paiseToRupeeStr(c.totalPaise), paiseToRupeeStr(c.outstandingPaise), c.lastDate]),
      ),
    cashiers: () =>
      downloadCsv(
        `sales-cashiers-${periodTag}.csv`,
        ["Cashier", "Bills", "Total", "Collected"],
        cashiers.map((c) => [c.name, c.docs, paiseToRupeeStr(c.totalPaise), paiseToRupeeStr(c.paidPaise)]),
      ),
    cancelled: () =>
      downloadCsv(
        `sales-cancelled-${periodTag}.csv`,
        ["Date", "Invoice", "Party", "Total"],
        cancelled.map((i) => [i.invoice_date, i.invoice_no ?? i.id.slice(0, 8), i.ledgers?.name ?? "Walk-in", paiseToRupeeStr(i.total_paise)]),
      ),
  };

  const hasAny = invoices.length > 0;

  return (
    <Page width="lg">
      <PageHeader
        icon={FileText}
        title="Sales reports"
        subtitle={scopeLabelFor(shops, shopFilter, shop?.name)}
        actions={
          <>
            <ShopSelect shops={shops} value={shopFilter} onChange={setShopFilter} />
            <RangeControls from={range.from} to={range.to} onChange={setRange} />
            <ExportButton onExport={exporters[view]} disabled={!hasAny} />
          </>
        }
      />

      {
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Invoices" value={totals.count} hint={`${range.from} → ${range.to}`} />
            <StatCard label="Taxable value" value={formatPaise(totals.taxable)} />
            <StatCard label="GST" value={formatPaise(totals.gst)} />
            <StatCard label="Total sales" value={formatPaise(totals.total)} />
          </div>

          <ViewTabs views={VIEWS} value={view} onChange={setView} />

          {view === "register" && (
            <DataTable<SalesInvoiceRow>
              cols="0.8fr 1fr 1.5fr 0.7fr 1fr 0.9fr 1fr"
              rows={placed}
              rowKey={(r) => r.id}
              loading={loading}
              onRowActivate={(r) => navigate(`/bills/${r.id}`)}
              empty={<EmptyState title="No sales in range" hint="Adjust the date range or record sales at the counter." />}
              columns={[
                { key: "date", header: "Date", cell: (r) => r.invoice_date },
                { key: "no", header: "Invoice", cell: (r) => <span className="tabular-nums">{r.invoice_no ?? `#${r.id.slice(0, 8)}`}</span> },
                { key: "party", header: "Party", cell: (r) => r.ledgers?.name ?? "Walk-in" },
                { key: "pay", header: "Pay", cell: (r) => payLabel(r.payment_method) },
                { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxable_paise) },
                { key: "gst", header: "GST", numeric: true, cell: (r) => formatPaise(gstOf(r)) },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.total_paise) },
              ]}
            />
          )}

          {view === "items" && (
            <DataTable<LineGroup>
              cols="1.8fr 0.6fr 0.6fr 1fr 1fr"
              rows={items}
              rowKey={(r) => r.key}
              loading={loading}
              empty={<EmptyState title="No items sold in range" />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.label },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "lines", header: "Lines", numeric: true, cell: (r) => r.lines },
                { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
              ]}
            />
          )}

          {view === "categories" && (
            <div className="flex flex-col gap-6">
              <CategoryTable title="By GST rate" rows={byRate} loading={loading} />
              <CategoryTable title="By schedule (H / H1 / X / OTC)" rows={bySchedule} loading={loading} />
            </div>
          )}

          {view === "customers" && (
            <DataTable<PartyGroup>
              cols="1.6fr 0.6fr 1fr 1fr 0.9fr"
              rows={customers}
              rowKey={(r) => r.key}
              loading={loading}
              onRowActivate={(r) => (r.key === "walk-in" ? undefined : navigate(`/parties/${r.key}`))}
              empty={<EmptyState title="No customers in range" />}
              columns={[
                { key: "name", header: "Customer", cell: (r) => r.name },
                { key: "bills", header: "Bills", numeric: true, cell: (r) => r.docs },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
                {
                  key: "out",
                  header: "Outstanding",
                  numeric: true,
                  cell: (r) => (
                    <span className={r.outstandingPaise > 0 ? "text-text-primary" : "text-success"}>{formatPaise(r.outstandingPaise)}</span>
                  ),
                },
                { key: "last", header: "Last sale", cell: (r) => r.lastDate },
              ]}
            />
          )}

          {view === "cashiers" && (
            <DataTable<PartyGroup>
              cols="1.6fr 0.6fr 1fr 1fr"
              rows={cashiers}
              rowKey={(r) => r.key}
              loading={loading}
              empty={<EmptyState title="No sales in range" />}
              columns={[
                { key: "name", header: "Cashier", cell: (r) => r.name },
                { key: "bills", header: "Bills", numeric: true, cell: (r) => r.docs },
                { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
                { key: "collected", header: "Collected", numeric: true, cell: (r) => formatPaise(r.paidPaise) },
              ]}
            />
          )}

          {view === "cancelled" && (
            <div className="flex flex-col gap-2">
              <DataTable<SalesInvoiceRow>
                cols="1fr 1.2fr 1.8fr 1fr"
                rows={cancelled}
                rowKey={(r) => r.id}
                loading={loading}
                onRowActivate={(r) => navigate(`/bills/${r.id}`)}
                empty={<EmptyState title="No cancelled invoices" hint="Cancelled invoices in this range would appear here." />}
                columns={[
                  { key: "date", header: "Date", cell: (r) => r.invoice_date },
                  { key: "no", header: "Invoice", cell: (r) => <span className="tabular-nums">{r.invoice_no ?? `#${r.id.slice(0, 8)}`}</span> },
                  { key: "party", header: "Party", cell: (r) => r.ledgers?.name ?? "Walk-in" },
                  { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.total_paise) },
                ]}
              />
              <p className="text-xs text-text-tertiary">
                Sales returns (credit notes) re-stock and reduce the bill. They will show here once the Returns module lands.
              </p>
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            Operational (post-cutover) invoices. Item / category / customer / cashier figures cover placed invoices only;
            cancelled invoices are excluded from totals.
          </p>
        </div>
      }
    </Page>
  );
}

function CategoryTable({ title, rows, loading }: { title: string; rows: LineGroup[]; loading: boolean }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-text-secondary">{title}</h2>
      <DataTable<LineGroup>
        cols="1.4fr 0.6fr 1fr 1fr"
        rows={rows}
        rowKey={(r) => r.key}
        loading={loading}
        empty={<EmptyState title="Nothing in range" />}
        columns={[
          { key: "cat", header: "Category", cell: (r) => r.label },
          { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
          { key: "taxable", header: "Taxable", numeric: true, cell: (r) => formatPaise(r.taxablePaise) },
          { key: "total", header: "Total", numeric: true, cell: (r) => formatPaise(r.totalPaise) },
        ]}
      />
    </section>
  );
}
