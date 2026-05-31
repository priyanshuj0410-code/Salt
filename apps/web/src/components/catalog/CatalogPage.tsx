import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PackagePlus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { DataTable, type Column } from "@/components/patterns/data-table";
import { ScheduleBadge } from "@/components/catalog/ScheduleBadge";
import { mrpRange } from "@/components/catalog/format";
import { CreateItemDialog } from "@/components/grn/CreateItemDialog";
import { useAuth } from "@/lib/auth";
import { useCatalog } from "@/store/catalog";
import { searchCatalog, itemStock } from "@/lib/search";
import type { Item } from "@/lib/types";

const SCHED_FILTERS = ["All", "OTC", "H", "H1", "X"] as const;
const STOCK_FILTERS = ["All", "In stock", "Out"] as const;
type SchedFilter = (typeof SCHED_FILTERS)[number];
type StockFilter = (typeof STOCK_FILTERS)[number];

/**
 * Catalogue / drug master browse + search (SALT-079). The single place to find
 * any item by name, salt, manufacturer, HSN or barcode, see its schedule, GST
 * and live stock, and open it to view/edit. Reads the org's items from the
 * shared catalog store (Supabase items+batches, demo seed as fallback).
 */
export function CatalogPage() {
  const orgId = useAuth().membership?.orgId;
  const navigate = useNavigate();
  const items = useCatalog((s) => s.items);
  const loading = useCatalog((s) => s.loading);
  const loaded = useCatalog((s) => s.loaded);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const loadCatalog = useCatalog((s) => s.load);
  const upsertItem = useCatalog((s) => s.upsertItem);

  const [query, setQuery] = useState("");
  const [sched, setSched] = useState<SchedFilter>("All");
  const [stock, setStock] = useState<StockFilter>("All");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  const stats = useMemo(() => {
    let inStock = 0;
    let scheduled = 0;
    for (const i of items) {
      if (itemStock(i) > 0) inStock++;
      if (i.schedule !== "OTC") scheduled++;
    }
    return { total: items.length, inStock, outOfStock: items.length - inStock, scheduled };
  }, [items]);

  const visible = useMemo(() => {
    const base = query.trim()
      ? searchCatalog(query, items)
      : [...items].sort((a, b) => a.name.localeCompare(b.name));
    return base.filter((i) => {
      if (sched !== "All" && i.schedule !== sched) return false;
      const qty = itemStock(i);
      if (stock === "In stock" && qty <= 0) return false;
      if (stock === "Out" && qty > 0) return false;
      return true;
    });
  }, [items, query, sched, stock]);

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Item",
      cell: (i) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-text-primary">{i.name}</div>
          <div className="truncate text-xs text-text-tertiary">
            {i.salt || "—"}
            {i.manufacturer ? ` · ${i.manufacturer}` : ""}
          </div>
        </div>
      ),
    },
    { key: "pack", header: "Pack", cell: (i) => i.pack || "—" },
    { key: "schedule", header: "Schedule", cell: (i) => <ScheduleBadge schedule={i.schedule} /> },
    { key: "gst", header: "GST", numeric: true, cell: (i) => `${i.gstRate}%` },
    { key: "hsn", header: "HSN", cell: (i) => <span className="font-mono text-xs">{i.hsn || "—"}</span> },
    {
      key: "stock",
      header: "Stock",
      numeric: true,
      cell: (i) => {
        const qty = itemStock(i);
        return qty > 0 ? (
          qty.toLocaleString("en-IN")
        ) : (
          <span className="text-danger">Out</span>
        );
      },
    },
    { key: "mrp", header: "MRP", numeric: true, cell: (i) => mrpRange(i) },
  ];

  return (
    <Page width="lg">
      <PageHeader
        icon={Tag}
        title="Catalogue"
        subtitle="Your drug master — search by name, salt, manufacturer, HSN or barcode. Open an item to view or edit it."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PackagePlus /> New item
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Items" value={stats.total.toLocaleString("en-IN")} />
        <StatCard label="In stock" value={stats.inStock.toLocaleString("en-IN")} />
        <StatCard
          label="Out of stock"
          value={stats.outOfStock.toLocaleString("en-IN")}
          tone={stats.outOfStock > 0 ? "danger" : "default"}
        />
        <StatCard label="Scheduled (H/H1/X)" value={stats.scheduled.toLocaleString("en-IN")} />
      </div>

      {usingSeed && (
        <p className="mt-4 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-xs text-info">
          Showing demo items. Import your ledgers or add items to build your own catalogue.
        </p>
      )}

      {/* Search + filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, salt, manufacturer, HSN or barcode…"
          className="h-9 max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {SCHED_FILTERS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={sched === s ? "default" : "outline"}
              onClick={() => setSched(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STOCK_FILTERS.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={stock === s ? "default" : "outline"}
              onClick={() => setStock(s)}
            >
              {s === "Out" ? "Out of stock" : s}
            </Button>
          ))}
        </div>
        <span className="ml-auto text-xs text-text-tertiary">
          {visible.length === items.length ? `${items.length}` : `${visible.length} of ${items.length}`} items
        </span>
      </div>

      <div className="mt-3">
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(i) => i.id}
          cols="minmax(0,2fr) 1fr 0.8fr 0.55fr 0.9fr 0.65fr 1fr"
          onRowActivate={(i) => navigate(`/catalogue/${i.id}`)}
          loading={loading && !loaded}
          empty={
            items.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="No items yet"
                hint="Import your catalogue from Settings → Import, or add an item by hand."
                action={
                  <Button variant="outline" onClick={() => setCreateOpen(true)}>
                    <PackagePlus /> New item
                  </Button>
                }
              />
            ) : (
              <p className="px-3 py-6 text-sm text-text-tertiary">No items match these filters.</p>
            )
          }
        />
      </div>

      <CreateItemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(item) => {
          upsertItem(item);
          navigate(`/catalogue/${item.id}`);
        }}
      />
    </Page>
  );
}
