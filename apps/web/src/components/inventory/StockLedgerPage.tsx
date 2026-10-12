import { useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Input } from "@/components/ui/input";
import { formatPaise } from "@/lib/currency";
import { useInventory, type EnrichedBatch } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";
import { ExpiryCell } from "./StockBits";

export function StockLedgerPage() {
  const { batches, loading } = useInventory();
  const [q, setQ] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return batches
      .filter((b) => (showEmpty ? true : b.qty > 0))
      .filter(
        (b) =>
          !needle ||
          b.name.toLowerCase().includes(needle) ||
          (b.salt ?? "").toLowerCase().includes(needle) ||
          (b.batch_no ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || (a.daysToExpiry ?? 1e9) - (b.daysToExpiry ?? 1e9));
  }, [batches, q, showEmpty]);

  const skus = useMemo(() => new Set(rows.map((r) => r.item_id)).size, [rows]);
  const costValue = useMemo(() => rows.reduce((s, r) => s + r.costValuePaise, 0), [rows]);
  const mrpValue = useMemo(() => rows.reduce((s, r) => s + r.mrpValuePaise, 0), [rows]);

  return (
    <Page width="full">
      <PageHeader
        icon={Package}
        title="Stock ledger"
        subtitle="On-hand quantity per item and batch, with expiry, MRP and cost"
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="SKUs in stock" value={skus} />
        <StatCard label="Batches" value={rows.length} />
        <StatCard label="Stock value (cost)" value={formatPaise(costValue)} hint="Σ qty × PTR" />
        <StatCard label="Retail value (MRP)" value={formatPaise(mrpValue)} hint="Σ qty × MRP" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search item, salt or batch…"
            className="pl-8"
          />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-text-secondary">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Show empty batches
        </label>
      </div>

      <DataTable<EnrichedBatch>
        rows={rows}
        rowKey={(b) => b.batch_id}
        cols="1.8fr 0.9fr 1fr 0.6fr 0.8fr 0.8fr 0.9fr"
        loading={loading}
        empty={
          <EmptyState
            icon={Package}
            title="No stock on hand"
            hint="Receive a GRN under Purchases, or import opening stock, to populate the ledger."
          />
        }
        columns={[
          {
            key: "item",
            header: "Item",
            cell: (b) => (
              <div className="min-w-0">
                <div className="truncate">{b.name}</div>
                <div className="truncate text-xs text-text-tertiary">
                  {[b.pack, b.salt].filter(Boolean).join(" · ") || "-"}
                </div>
              </div>
            ),
          },
          { key: "batch", header: "Batch", cell: (b) => <span className="text-text-secondary">{b.batch_no ?? "-"}</span> },
          { key: "expiry", header: "Expiry", cell: (b) => <ExpiryCell b={b} /> },
          { key: "qty", header: "Qty", numeric: true, cell: (b) => b.qty },
          { key: "mrp", header: "MRP", numeric: true, cell: (b) => formatPaise(b.mrp_paise) },
          {
            key: "cost",
            header: "Cost",
            numeric: true,
            cell: (b) => <span className="text-text-tertiary">{formatPaise(b.ptr_paise)}</span>,
          },
          { key: "value", header: "Value", numeric: true, cell: (b) => formatPaise(b.costValuePaise) },
        ]}
      />
    </Page>
  );
}
