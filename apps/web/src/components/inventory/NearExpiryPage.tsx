import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/currency";
import { useInventory, type EnrichedBatch } from "@/lib/inventory";
import { InventoryNav } from "./InventoryNav";

const WINDOWS = [30, 60, 90] as const;
type Sort = "soonest" | "value";

/** Days-to-expiry as a colored chip: red once expired, amber within 30 days. */
function DaysLeft({ days }: { days: number | null }) {
  if (days == null) return <span className="text-text-tertiary">—</span>;
  if (days < 0) return <span className="font-medium text-danger">expired</span>;
  return <span className={cn(days <= 30 ? "font-medium text-warning" : "text-text-secondary")}>{days}d</span>;
}

export function NearExpiryPage() {
  const { batches, loading } = useInventory();
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(90);
  const [sort, setSort] = useState<Sort>("soonest");

  // Batches with stock on hand that are expired or expiring within the window.
  const rows = useMemo(() => {
    const inWindow = batches.filter(
      (b) => b.qty > 0 && b.daysToExpiry != null && b.daysToExpiry <= win,
    );
    return inWindow.sort((a, b) =>
      sort === "value"
        ? b.mrpValuePaise - a.mrpValuePaise
        : (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0),
    );
  }, [batches, win, sort]);

  const atRiskMrp = useMemo(() => rows.reduce((s, r) => s + r.mrpValuePaise, 0), [rows]);
  const atRiskCost = useMemo(() => rows.reduce((s, r) => s + r.costValuePaise, 0), [rows]);
  const expiredCount = useMemo(() => rows.filter((r) => (r.daysToExpiry ?? 0) < 0).length, [rows]);

  return (
    <Page width="full">
      <PageHeader
        icon={CalendarClock}
        title="Near expiry"
        subtitle="Batches expiring soon — return to the distributor before they are a write-off"
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Batches at risk" value={rows.length} hint={`within ${win} days`} />
        <StatCard label="Retail at risk (MRP)" value={formatPaise(atRiskMrp)} tone="danger" />
        <StatCard label="Cost at risk" value={formatPaise(atRiskCost)} hint="what we paid" />
        <StatCard label="Already expired" value={expiredCount} tone={expiredCount > 0 ? "danger" : "default"} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <Button key={w} size="sm" variant={win === w ? "secondary" : "ghost"} onClick={() => setWin(w)}>
              {w} days
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-text-tertiary">Sort</span>
          <Button size="sm" variant={sort === "soonest" ? "secondary" : "ghost"} onClick={() => setSort("soonest")}>
            Soonest
          </Button>
          <Button size="sm" variant={sort === "value" ? "secondary" : "ghost"} onClick={() => setSort("value")}>
            Value
          </Button>
        </div>
      </div>

      <DataTable<EnrichedBatch>
        rows={rows}
        rowKey={(b) => b.batch_id}
        cols="1.8fr 0.9fr 0.9fr 0.7fr 0.6fr 1fr"
        loading={loading}
        empty={
          <EmptyState
            icon={CalendarClock}
            title="Nothing expiring soon"
            hint={`No on-hand batch expires within ${win} days. Widen the window or check back later.`}
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
                  {[b.pack, b.manufacturer].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
            ),
          },
          { key: "batch", header: "Batch", cell: (b) => <span className="text-text-secondary">{b.batch_no ?? "—"}</span> },
          {
            key: "expiry",
            header: "Expires",
            cell: (b) => <span className="text-text-tertiary">{b.expiryAt ? format(b.expiryAt, "MMM yyyy") : (b.expiry ?? "—")}</span>,
          },
          { key: "days", header: "In", cell: (b) => <DaysLeft days={b.daysToExpiry} /> },
          { key: "qty", header: "Qty", numeric: true, cell: (b) => b.qty },
          { key: "risk", header: "At risk (MRP)", numeric: true, cell: (b) => formatPaise(b.mrpValuePaise) },
        ]}
      />
    </Page>
  );
}
