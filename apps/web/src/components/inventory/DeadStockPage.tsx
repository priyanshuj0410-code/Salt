import { useMemo, useState } from "react";
import { format } from "date-fns";
import { PackageX } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/currency";
import { useInventory, deadStock, daysSinceSold, type ItemAgg } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";

const THRESHOLDS = [30, 60, 90] as const;

export function DeadStockPage() {
  const { items, loading, lookbackDays } = useInventory();
  const [n, setN] = useState<(typeof THRESHOLDS)[number]>(90);
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(() => deadStock(items, n, now), [items, n, now]);
  const capital = useMemo(() => rows.reduce((s, r) => s + r.costValuePaise, 0), [rows]);
  const retail = useMemo(() => rows.reduce((s, r) => s + r.mrpValuePaise, 0), [rows]);

  return (
    <Page width="full">
      <PageHeader
        icon={PackageX}
        title="Dead / slow stock"
        subtitle={`On-hand items with no sale in the last ${n} days, capital sitting idle`}
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Dead SKUs" value={rows.length} hint={`no sale in ${n} days`} />
        <StatCard label="Capital tied up" value={formatPaise(capital)} tone="danger" hint="at cost (PTR)" />
        <StatCard label="Retail value" value={formatPaise(retail)} hint="at MRP" />
      </div>

      <div className="mb-3 flex items-center gap-1">
        <span className="mr-1 text-sm text-text-tertiary">No sale in</span>
        {THRESHOLDS.map((t) => (
          <Button key={t} size="sm" variant={n === t ? "secondary" : "ghost"} onClick={() => setN(t)}>
            {t} days
          </Button>
        ))}
      </div>

      <DataTable<ItemAgg>
        rows={rows}
        rowKey={(it) => it.item_id}
        cols="1.8fr 0.7fr 1fr 0.9fr 0.9fr"
        loading={loading}
        empty={
          <EmptyState
            icon={PackageX}
            title="No dead stock"
            hint={`Every on-hand item has sold within the last ${n} days. Nicely cycled.`}
          />
        }
        columns={[
          {
            key: "item",
            header: "Item",
            cell: (it) => (
              <div className="min-w-0">
                <div className="truncate">{it.name}</div>
                <div className="truncate text-xs text-text-tertiary">
                  {[it.pack, it.manufacturer].filter(Boolean).join(" · ") || "-"}
                </div>
              </div>
            ),
          },
          { key: "qty", header: "On hand", numeric: true, cell: (it) => it.onHand },
          {
            key: "last",
            header: "Last sold",
            cell: (it) =>
              it.lastSoldAt ? (
                <span className="text-text-secondary">{format(it.lastSoldAt, "d MMM yyyy")}</span>
              ) : (
                <span className="text-text-tertiary">{`> ${lookbackDays}d ago`}</span>
              ),
          },
          {
            key: "idle",
            header: "Idle",
            numeric: true,
            cell: (it) => {
              const d = daysSinceSold(it, now);
              return <span className="text-text-tertiary">{d == null ? `${lookbackDays}+d` : `${d}d`}</span>;
            },
          },
          { key: "value", header: "Capital", numeric: true, cell: (it) => formatPaise(it.costValuePaise) },
        ]}
      />
    </Page>
  );
}
