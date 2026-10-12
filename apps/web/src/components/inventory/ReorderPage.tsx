import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatPaise } from "@/lib/currency";
import { useInventory, reorderList, suggestedOrderQty, type ItemAgg } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";

const COVERS = [15, 30, 60] as const;

export function ReorderPage() {
  const { items, loading } = useInventory();
  const [cover, setCover] = useState<(typeof COVERS)[number]>(30);

  const rows = useMemo(() => reorderList(items), [items]);
  const suggest = useMemo(() => new Map(rows.map((r) => [r.item_id, suggestedOrderQty(r, cover)])), [rows, cover]);
  const orderValue = useMemo(
    () => rows.reduce((s, r) => s + (suggest.get(r.item_id) ?? 0) * r.avgPtrPaise, 0),
    [rows, suggest],
  );
  const outOfStock = useMemo(() => rows.filter((r) => r.onHand <= 0).length, [rows]);

  return (
    <Page width="full">
      <PageHeader
        icon={ClipboardList}
        title="Reorder"
        subtitle="Items at or below their reorder level, with a suggested order quantity from recent velocity"
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Items to reorder" value={rows.length} />
        <StatCard label="Of which out of stock" value={outOfStock} tone={outOfStock > 0 ? "danger" : "default"} />
        <StatCard label="Suggested order value" value={formatPaise(orderValue)} hint={`${cover}-day cover, at cost`} />
      </div>

      <div className="mb-3 flex items-center gap-1">
        <span className="mr-1 text-sm text-text-tertiary">Cover</span>
        {COVERS.map((c) => (
          <Button key={c} size="sm" variant={cover === c ? "secondary" : "ghost"} onClick={() => setCover(c)}>
            {c} days
          </Button>
        ))}
      </div>

      <DataTable<ItemAgg>
        rows={rows}
        rowKey={(it) => it.item_id}
        cols="1.8fr 0.7fr 0.7fr 0.8fr 0.8fr 0.9fr"
        loading={loading}
        empty={
          <EmptyState
            icon={ClipboardList}
            title="Nothing to reorder"
            hint="No item is at or below its reorder level. Set reorder levels on items in the catalogue to see suggestions here."
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
          {
            key: "qty",
            header: "On hand",
            numeric: true,
            cell: (it) =>
              it.onHand <= 0 ? <Badge variant="danger">0</Badge> : <span>{it.onHand}</span>,
          },
          { key: "level", header: "Reorder at", numeric: true, cell: (it) => <span className="text-text-tertiary">{it.reorder_level}</span> },
          {
            key: "vel",
            header: "Velocity",
            numeric: true,
            cell: (it) => <span className="text-text-tertiary">{Math.round(it.velocityPerDay * 30)}/mo</span>,
          },
          {
            key: "order",
            header: "Suggested",
            numeric: true,
            cell: (it) => <span className="font-medium">{suggest.get(it.item_id) ?? 0}</span>,
          },
          {
            key: "cost",
            header: "Est. cost",
            numeric: true,
            cell: (it) => formatPaise((suggest.get(it.item_id) ?? 0) * it.avgPtrPaise),
          },
        ]}
      />
    </Page>
  );
}
