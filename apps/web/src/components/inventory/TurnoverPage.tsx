import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/currency";
import { useInventory, turnoverBy, turnoverRatio, type TurnoverDim, type TurnoverGroup } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";

const DIMS: { key: TurnoverDim; label: string }[] = [
  { key: "item", label: "Item" },
  { key: "category", label: "Category" },
  { key: "manufacturer", label: "Manufacturer" },
];

/** "2.4×" — annualised turns. Dash when there is no inventory to turn over. */
const fmtRatio = (r: number) => (r > 0 ? `${r.toFixed(1)}×` : "—");

export function TurnoverPage() {
  const { items, loading, lookbackDays } = useInventory();
  const [dim, setDim] = useState<TurnoverDim>("item");

  const rows = useMemo(() => turnoverBy(items, dim, lookbackDays), [items, dim, lookbackDays]);
  const totalCogs = useMemo(() => rows.reduce((s, r) => s + r.cogsWindowPaise, 0), [rows]);
  const totalInv = useMemo(() => rows.reduce((s, r) => s + r.inventoryValuePaise, 0), [rows]);
  const overall = useMemo(() => turnoverRatio(totalCogs, totalInv, lookbackDays), [totalCogs, totalInv, lookbackDays]);

  return (
    <Page width="full">
      <PageHeader
        icon={Repeat}
        title="Stock turnover"
        subtitle={`How fast stock cycles — annualised from the last ${lookbackDays} days of sales`}
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Overall turnover" value={fmtRatio(overall)} hint="annualised COGS ÷ stock value" />
        <StatCard label="COGS in window" value={formatPaise(totalCogs)} hint={`last ${lookbackDays} days, at cost`} />
        <StatCard label="Stock value" value={formatPaise(totalInv)} hint="on hand, at cost" />
      </div>

      <div className="mb-3 flex items-center gap-1">
        <span className="mr-1 text-sm text-text-tertiary">By</span>
        {DIMS.map((d) => (
          <Button key={d.key} size="sm" variant={dim === d.key ? "secondary" : "ghost"} onClick={() => setDim(d.key)}>
            {d.label}
          </Button>
        ))}
      </div>

      <DataTable<TurnoverGroup>
        rows={rows}
        rowKey={(g) => g.key}
        cols="2fr 1fr 1fr 0.7fr"
        loading={loading}
        empty={
          <EmptyState
            icon={Repeat}
            title="No turnover yet"
            hint="Once sales are recorded against stock, turnover ratios appear here."
          />
        }
        columns={[
          { key: "label", header: DIMS.find((d) => d.key === dim)?.label ?? "Group", cell: (g) => <span className="truncate">{g.label}</span> },
          { key: "cogs", header: "COGS", numeric: true, cell: (g) => formatPaise(g.cogsWindowPaise) },
          {
            key: "inv",
            header: "Stock value",
            numeric: true,
            cell: (g) => <span className="text-text-tertiary">{formatPaise(g.inventoryValuePaise)}</span>,
          },
          { key: "ratio", header: "Turns", numeric: true, cell: (g) => <span className="font-medium">{fmtRatio(g.ratio)}</span> },
        ]}
      />
    </Page>
  );
}
