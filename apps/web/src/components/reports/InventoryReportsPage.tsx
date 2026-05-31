import { useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";

import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { ViewTabs, RangeControls, ExportButton, type ReportView } from "@/components/reports/report-controls";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { formatPaise } from "@/lib/currency";
import { fetchAllPaged } from "@/lib/reportData";
import {
  presetRange,
  rollupStock,
  sumBy,
  downloadCsv,
  paiseToRupeeStr,
  type StockRow,
  type StockItemAgg,
} from "@/lib/reports";

interface StockOnHandRow extends StockRow {
  batch_no: string | null;
  expiry_date: string | null;
}
interface NearExpiryRow {
  item_name: string;
  batch_no: string | null;
  expiry_date: string | null;
  qty: number;
  days_to_expiry: number;
  bucket: string;
  stock_value_paise: number;
}
interface DeadRow {
  item_name: string;
  qty: number;
  stock_value_paise: number;
  last_sold_at: string | null;
}
interface MovementRow {
  created_at: string;
  qty_delta: number;
  reason: string;
  unit_cost_paise: number;
  ref_table: string | null;
  items: { name: string | null } | null;
  batches: { batch_no: string | null } | null;
}
interface CountLineRow {
  system_qty: number;
  counted_qty: number;
  variance: number;
  items: { name: string | null } | null;
  physical_counts: { count_date: string; status: string } | null;
}

type ViewKey = "stock" | "valuation" | "expiry" | "dead" | "low" | "movement" | "variance";
const VIEWS: ReportView<ViewKey>[] = [
  { key: "stock", label: "Stock on hand" },
  { key: "valuation", label: "Valuation" },
  { key: "expiry", label: "Near expiry" },
  { key: "dead", label: "Dead / slow" },
  { key: "low", label: "Low stock" },
  { key: "movement", label: "Movement" },
  { key: "variance", label: "Count variance" },
];

/** On-hand units at or below this count surface in the low-stock view (until
 *  per-item reorder levels exist — see the filed catalogue ticket). */
const LOW_STOCK_QTY = 10;

const REASON_LABEL: Record<string, string> = {
  sale: "Sale",
  sale_return: "Sale return",
  purchase: "Purchase",
  purchase_return: "Purchase return",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjustment",
  writeoff: "Write-off",
  opening: "Opening",
};

const bucketTone = (bucket: string, days: number) =>
  days < 0 || bucket === "expired"
    ? "text-danger"
    : bucket === "0-30"
      ? "text-danger"
      : bucket === "31-60"
        ? "text-warning"
        : undefined;

export function InventoryReportsPage() {
  const { membership, shopId, shop, loading: authLoading } = useAuth();
  const orgId = membership?.orgId;
  const [range, setRange] = useState(() => presetRange("month"));
  const [view, setView] = useState<ViewKey>("stock");
  const [stock, setStock] = useState<StockOnHandRow[]>([]);
  const [expiry, setExpiry] = useState<NearExpiryRow[]>([]);
  const [dead, setDead] = useState<DeadRow[]>([]);
  const [moves, setMoves] = useState<MovementRow[]>([]);
  const [counts, setCounts] = useState<CountLineRow[]>([]);
  const [snapLoading, setSnapLoading] = useState(true);
  const [rangeLoading, setRangeLoading] = useState(true);

  // Snapshot views — current stock, independent of the date range.
  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const db = supabase;
    (async () => {
      setSnapLoading(true);
      const [st, ex, dd] = await Promise.all([
        fetchAllPaged<StockOnHandRow>((f, t) =>
          db
            .from("v_stock_on_hand")
            .select("item_id,item_name,batch_no,expiry_date,qty,mrp_paise,ptr_paise,stock_value_paise")
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .order("stock_value_paise", { ascending: false })
            .range(f, t),
        ),
        fetchAllPaged<NearExpiryRow>((f, t) =>
          db
            .from("v_near_expiry")
            .select("item_name,batch_no,expiry_date,qty,days_to_expiry,bucket,stock_value_paise")
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .lte("days_to_expiry", 90)
            .order("days_to_expiry", { ascending: true })
            .range(f, t),
        ),
        fetchAllPaged<DeadRow>((f, t) =>
          db
            .from("v_dead_stock")
            .select("item_name,qty,stock_value_paise,last_sold_at")
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .order("stock_value_paise", { ascending: false })
            .range(f, t),
        ),
      ]);
      if (!active) return;
      setStock(st);
      setExpiry(ex);
      setDead(dd);
      setSnapLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId]);

  // Time-based views — stock movements + physical-count variance in the range.
  useEffect(() => {
    if (!supabase || !orgId || !shopId) return;
    let active = true;
    const db = supabase;
    const { from, to } = range;
    (async () => {
      setRangeLoading(true);
      const [mv, ct] = await Promise.all([
        fetchAllPaged<MovementRow>((f, t) =>
          db
            .from("stock_movements")
            .select("created_at,qty_delta,reason,unit_cost_paise,ref_table,items(name),batches(batch_no)")
            .eq("org_id", orgId)
            .eq("shop_id", shopId)
            .gte("created_at", from)
            .lte("created_at", `${to}T23:59:59`)
            .order("created_at", { ascending: false })
            .range(f, t),
        ),
        fetchAllPaged<CountLineRow>((f, t) =>
          db
            .from("physical_count_lines")
            .select("system_qty,counted_qty,variance,items(name),physical_counts!inner(count_date,status)")
            .eq("org_id", orgId)
            .eq("physical_counts.status", "finalized")
            .gte("physical_counts.count_date", from)
            .lte("physical_counts.count_date", to)
            .range(f, t),
        ),
      ]);
      if (!active) return;
      setMoves(mv);
      setCounts(ct);
      setRangeLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, shopId, range]);

  const byItem = useMemo(() => rollupStock(stock), [stock]);
  const lowStock = useMemo(() => byItem.filter((i) => i.qty <= LOW_STOCK_QTY).sort((a, b) => a.qty - b.qty), [byItem]);
  const stockKpis = useMemo(
    () => ({
      skus: byItem.length,
      batches: stock.length,
      cost: sumBy(stock, (r) => r.stock_value_paise),
      mrp: sumBy(stock, (r) => r.qty * r.mrp_paise),
    }),
    [byItem, stock],
  );
  const expiryValue = useMemo(() => sumBy(expiry, (r) => r.stock_value_paise), [expiry]);

  const periodTag = `${range.from}_${range.to}`;
  const exporters: Record<ViewKey, () => void> = {
    stock: () =>
      downloadCsv(
        "stock-on-hand.csv",
        ["Item", "Batch", "Expiry", "Qty", "MRP", "Cost", "Stock value (cost)"],
        stock.map((r) => [r.item_name, r.batch_no ?? "", r.expiry_date ?? "", r.qty, paiseToRupeeStr(r.mrp_paise), paiseToRupeeStr(r.ptr_paise), paiseToRupeeStr(r.stock_value_paise)]),
      ),
    valuation: () =>
      downloadCsv(
        "stock-valuation.csv",
        ["Item", "Qty", "Batches", "Cost value", "MRP value", "Margin %"],
        byItem.map((i) => [i.name, i.qty, i.batches, paiseToRupeeStr(i.costPaise), paiseToRupeeStr(i.mrpPaise), marginPct(i)]),
      ),
    expiry: () =>
      downloadCsv(
        "near-expiry.csv",
        ["Item", "Batch", "Expiry", "Days", "Bucket", "Qty", "Value at risk"],
        expiry.map((r) => [r.item_name, r.batch_no ?? "", r.expiry_date ?? "", r.days_to_expiry, r.bucket, r.qty, paiseToRupeeStr(r.stock_value_paise)]),
      ),
    dead: () =>
      downloadCsv(
        "dead-stock.csv",
        ["Item", "Qty", "Stock value", "Last sold"],
        dead.map((r) => [r.item_name, r.qty, paiseToRupeeStr(r.stock_value_paise), r.last_sold_at ? r.last_sold_at.slice(0, 10) : "never"]),
      ),
    low: () =>
      downloadCsv(
        "low-stock.csv",
        ["Item", "On hand", "Batches", "Cost value"],
        lowStock.map((i) => [i.name, i.qty, i.batches, paiseToRupeeStr(i.costPaise)]),
      ),
    movement: () =>
      downloadCsv(
        `stock-movement-${periodTag}.csv`,
        ["Date", "Item", "Batch", "Reason", "Qty change", "Unit cost", "Source"],
        moves.map((m) => [m.created_at.slice(0, 10), m.items?.name ?? "—", m.batches?.batch_no ?? "", REASON_LABEL[m.reason] ?? m.reason, m.qty_delta, paiseToRupeeStr(m.unit_cost_paise), m.ref_table ?? ""]),
      ),
    variance: () =>
      downloadCsv(
        `count-variance-${periodTag}.csv`,
        ["Count date", "Item", "System", "Counted", "Variance"],
        counts.map((c) => [c.physical_counts?.count_date ?? "", c.items?.name ?? "—", c.system_qty, c.counted_qty, c.variance]),
      ),
  };

  const isRanged = view === "movement" || view === "variance";
  const hasExport =
    (view === "stock" && stock.length > 0) ||
    (view === "valuation" && byItem.length > 0) ||
    (view === "expiry" && expiry.length > 0) ||
    (view === "dead" && dead.length > 0) ||
    (view === "low" && lowStock.length > 0) ||
    (view === "movement" && moves.length > 0) ||
    (view === "variance" && counts.length > 0);

  return (
    <Page width="lg">
      <PageHeader
        icon={Package}
        title="Inventory reports"
        subtitle={shop?.name ?? "This shop"}
        actions={
          <>
            {isRanged && <RangeControls from={range.from} to={range.to} onChange={setRange} />}
            <ExportButton onExport={exporters[view]} disabled={!hasExport} />
          </>
        }
      />

      {!authLoading && !shopId ? (
        <EmptyState title="No shop selected" hint="Inventory reports summarise one shop. Pick a shop to continue." />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="SKUs in stock" value={stockKpis.skus} hint={`${stockKpis.batches} batches`} />
            <StatCard label="Stock value (cost)" value={formatPaise(stockKpis.cost)} />
            <StatCard label="Stock value (MRP)" value={formatPaise(stockKpis.mrp)} />
            <StatCard
              label="Near-expiry value"
              value={formatPaise(expiryValue)}
              tone={expiryValue > 0 ? "danger" : "success"}
              hint={`${expiry.length} batches ≤ 90d`}
            />
          </div>

          <ViewTabs views={VIEWS} value={view} onChange={setView} />

          {view === "stock" && (
            <DataTable<StockOnHandRow>
              cols="1.6fr 0.9fr 0.8fr 0.5fr 0.9fr 0.9fr 1fr"
              rows={stock}
              rowKey={(r) => `${r.item_id ?? r.item_name}:${r.batch_no ?? ""}`}
              loading={snapLoading}
              empty={<EmptyState title="No stock on hand" hint="Receive stock (GRN) to build the ledger." />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.item_name },
                { key: "batch", header: "Batch", cell: (r) => r.batch_no || "—" },
                { key: "exp", header: "Expiry", cell: (r) => r.expiry_date || "—" },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "mrp", header: "MRP", numeric: true, cell: (r) => formatPaise(r.mrp_paise) },
                { key: "cost", header: "Cost", numeric: true, cell: (r) => formatPaise(r.ptr_paise) },
                { key: "val", header: "Value", numeric: true, cell: (r) => formatPaise(r.stock_value_paise) },
              ]}
            />
          )}

          {view === "valuation" && (
            <DataTable<StockItemAgg>
              cols="1.8fr 0.6fr 0.6fr 1fr 1fr 0.7fr"
              rows={byItem}
              rowKey={(r) => r.itemId ?? `name:${r.name}`}
              loading={snapLoading}
              empty={<EmptyState title="No stock to value" />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.name },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "batches", header: "Batches", numeric: true, cell: (r) => r.batches },
                { key: "cost", header: "Cost value", numeric: true, cell: (r) => formatPaise(r.costPaise) },
                { key: "mrp", header: "MRP value", numeric: true, cell: (r) => formatPaise(r.mrpPaise) },
                { key: "margin", header: "Margin", numeric: true, cell: (r) => `${marginPct(r)}%` },
              ]}
            />
          )}

          {view === "expiry" && (
            <DataTable<NearExpiryRow>
              cols="1.5fr 0.9fr 0.8fr 0.6fr 0.5fr 1fr"
              rows={expiry}
              rowKey={(r) => `${r.item_name}:${r.batch_no ?? ""}:${r.expiry_date ?? ""}`}
              loading={snapLoading}
              empty={<EmptyState title="Nothing expiring within 90 days" hint="Near-expiry batches are surfaced here, most urgent first." />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.item_name },
                { key: "batch", header: "Batch", cell: (r) => r.batch_no || "—" },
                { key: "exp", header: "Expiry", cell: (r) => <span className={bucketTone(r.bucket, r.days_to_expiry)}>{r.expiry_date || "—"}</span> },
                { key: "days", header: "Days", numeric: true, cell: (r) => <span className={bucketTone(r.bucket, r.days_to_expiry)}>{r.days_to_expiry}</span> },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "val", header: "Value", numeric: true, cell: (r) => formatPaise(r.stock_value_paise) },
              ]}
            />
          )}

          {view === "dead" && (
            <DataTable<DeadRow>
              cols="2fr 0.6fr 1fr 1fr"
              rows={dead}
              rowKey={(r) => r.item_name}
              loading={snapLoading}
              empty={<EmptyState title="No dead stock" hint="Items with no sale in 90 days (and stock on hand) appear here." />}
              columns={[
                { key: "item", header: "Item", cell: (r) => r.item_name },
                { key: "qty", header: "Qty", numeric: true, cell: (r) => r.qty },
                { key: "val", header: "Stock value", numeric: true, cell: (r) => formatPaise(r.stock_value_paise) },
                { key: "last", header: "Last sold", cell: (r) => (r.last_sold_at ? r.last_sold_at.slice(0, 10) : "never") },
              ]}
            />
          )}

          {view === "low" && (
            <div className="flex flex-col gap-2">
              <DataTable<StockItemAgg>
                cols="2fr 0.7fr 0.7fr 1fr"
                rows={lowStock}
                rowKey={(r) => r.itemId ?? `name:${r.name}`}
                loading={snapLoading}
                empty={<EmptyState title="Nothing low on stock" hint={`Items with ${LOW_STOCK_QTY} units or fewer on hand appear here.`} />}
                columns={[
                  { key: "item", header: "Item", cell: (r) => r.name },
                  { key: "qty", header: "On hand", numeric: true, cell: (r) => <span className="text-warning">{r.qty}</span> },
                  { key: "batches", header: "Batches", numeric: true, cell: (r) => r.batches },
                  { key: "cost", header: "Cost value", numeric: true, cell: (r) => formatPaise(r.costPaise) },
                ]}
              />
              <p className="text-xs text-text-tertiary">
                Low-stock uses a flat {LOW_STOCK_QTY}-unit threshold; per-item reorder levels (and out-of-stock items) need a
                catalogue reorder field — a ticket is filed.
              </p>
            </div>
          )}

          {view === "movement" && (
            <DataTable<MovementRow>
              cols="0.9fr 1.6fr 0.8fr 1fr 0.7fr 0.9fr 0.9fr"
              rows={moves}
              rowKey={(r) => `${r.created_at}:${r.items?.name ?? ""}:${r.qty_delta}`}
              loading={rangeLoading}
              empty={<EmptyState title="No movements in range" hint="Sales, GRNs, transfers and adjustments post stock movements." />}
              columns={[
                { key: "date", header: "Date", cell: (r) => r.created_at.slice(0, 10) },
                { key: "item", header: "Item", cell: (r) => r.items?.name ?? "—" },
                { key: "batch", header: "Batch", cell: (r) => r.batches?.batch_no || "—" },
                { key: "reason", header: "Reason", cell: (r) => REASON_LABEL[r.reason] ?? r.reason },
                {
                  key: "delta",
                  header: "Qty Δ",
                  numeric: true,
                  cell: (r) => <span className={r.qty_delta < 0 ? "text-danger" : "text-success"}>{r.qty_delta > 0 ? `+${r.qty_delta}` : r.qty_delta}</span>,
                },
                { key: "cost", header: "Unit cost", numeric: true, cell: (r) => formatPaise(r.unit_cost_paise) },
                { key: "src", header: "Source", cell: (r) => r.ref_table ?? "—" },
              ]}
            />
          )}

          {view === "variance" && (
            <div className="flex flex-col gap-2">
              <DataTable<CountLineRow>
                cols="1fr 1.8fr 0.7fr 0.7fr 0.8fr"
                rows={counts}
                rowKey={(r) => `${r.physical_counts?.count_date ?? ""}:${r.items?.name ?? ""}:${r.system_qty}:${r.counted_qty}`}
                loading={rangeLoading}
                empty={<EmptyState title="No finalized counts in range" hint="Physical-count variances appear here once counts are finalized." />}
                columns={[
                  { key: "date", header: "Count date", cell: (r) => r.physical_counts?.count_date ?? "—" },
                  { key: "item", header: "Item", cell: (r) => r.items?.name ?? "—" },
                  { key: "sys", header: "System", numeric: true, cell: (r) => r.system_qty },
                  { key: "cnt", header: "Counted", numeric: true, cell: (r) => r.counted_qty },
                  {
                    key: "var",
                    header: "Variance",
                    numeric: true,
                    cell: (r) => <span className={r.variance === 0 ? undefined : r.variance < 0 ? "text-danger" : "text-success"}>{r.variance > 0 ? `+${r.variance}` : r.variance}</span>,
                  },
                ]}
              />
              <p className="text-xs text-text-tertiary">Variance = counted − system. Negative means shrinkage (less on the shelf than the books).</p>
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            Stock, valuation, expiry, dead and low-stock are current-state. Movement and count variance cover the selected
            date range. Cost uses batch PTR; valuation at batch cost ≈ weighted average.
          </p>
        </div>
      )}
    </Page>
  );
}

/** Retail margin over MRP value, as a whole-number percent (0 when no MRP). */
function marginPct(i: StockItemAgg): number {
  if (i.mrpPaise <= 0) return 0;
  return Math.round(((i.mrpPaise - i.costPaise) / i.mrpPaise) * 100);
}
