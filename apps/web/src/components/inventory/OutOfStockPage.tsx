import { useMemo } from "react";
import { format } from "date-fns";
import { Ban } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatPaise } from "@/lib/currency";
import { useInventory, outOfStock, daysSinceSold, lostSalesEstimate, type ItemAgg } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";

export function OutOfStockPage() {
  const { items, loading, lookbackDays } = useInventory();
  const now = useMemo(() => new Date(), []);

  // Out of stock but selling — ranked by estimated lost revenue (most painful first).
  const rows = useMemo(
    () =>
      outOfStock(items)
        .map((it) => ({ it, lost: lostSalesEstimate(it, now) }))
        .sort((a, b) => b.lost.revenuePaise - a.lost.revenuePaise),
    [items, now],
  );
  const lostRevenue = useMemo(() => rows.reduce((s, r) => s + r.lost.revenuePaise, 0), [rows]);
  const lostUnits = useMemo(() => rows.reduce((s, r) => s + r.lost.units, 0), [rows]);

  return (
    <Page width="full">
      <PageHeader
        icon={Ban}
        title="Out of stock"
        subtitle={`Items with demand but zero on hand — sold within the last ${lookbackDays} days`}
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Out-of-stock SKUs" value={rows.length} hint="with recent demand" />
        <StatCard label="Est. lost units" value={lostUnits} hint="while out of stock" />
        <StatCard label="Est. lost sales" value={formatPaise(lostRevenue)} tone="danger" hint="at MRP" />
      </div>

      <DataTable<{ it: ItemAgg; lost: { units: number; revenuePaise: number } }>
        rows={rows}
        rowKey={(r) => r.it.item_id}
        cols="1.8fr 1fr 0.7fr 0.7fr 0.8fr 0.9fr"
        loading={loading}
        empty={
          <EmptyState
            icon={Ban}
            title="Nothing out of stock"
            hint="Every item with recent demand still has stock on hand. No lost sales right now."
          />
        }
        columns={[
          {
            key: "item",
            header: "Item",
            cell: ({ it }) => (
              <div className="min-w-0">
                <div className="truncate">{it.name}</div>
                <div className="truncate text-xs text-text-tertiary">
                  {[it.pack, it.manufacturer].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            ),
          },
          {
            key: "last",
            header: "Last sold",
            cell: ({ it }) =>
              it.lastSoldAt ? (
                <span className="text-text-secondary">{format(it.lastSoldAt, "d MMM yyyy")}</span>
              ) : (
                <span className="text-text-tertiary">—</span>
              ),
          },
          {
            key: "out",
            header: "Days out",
            numeric: true,
            cell: ({ it }) => {
              const d = daysSinceSold(it, now);
              return <span className="text-text-tertiary">{d == null ? "—" : `${d}d`}</span>;
            },
          },
          {
            key: "vel",
            header: "Velocity",
            numeric: true,
            cell: ({ it }) => <span className="text-text-tertiary">{Math.round(it.velocityPerDay * 30)}/mo</span>,
          },
          { key: "lostu", header: "Lost units", numeric: true, cell: ({ lost }) => lost.units },
          { key: "lostr", header: "Lost sales", numeric: true, cell: ({ lost }) => formatPaise(lost.revenuePaise) },
        ]}
      />
    </Page>
  );
}
