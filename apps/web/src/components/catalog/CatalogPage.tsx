import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, GitMerge, PackagePlus, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { DataTable, type Column } from "@/components/patterns/data-table";
import { ScheduleBadge, AyushBadge } from "@/components/catalog/ScheduleBadge";
import { mrpRange } from "@/components/catalog/format";
import { CreateItemDialog } from "@/components/grn/CreateItemDialog";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { useCatalog } from "@/store/catalog";
import { searchCatalog, itemStock } from "@/lib/search";
import { findDuplicateGroups, type DuplicateGroup } from "@/lib/itemDupes";
import { planEnrichment, type EnrichPlanRow, type MasterRow } from "@/lib/masterEnrich";
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
  const [ayushOnly, setAyushOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichPlan, setEnrichPlan] = useState<EnrichPlanRow[] | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichDone, setEnrichDone] = useState<number | null>(null);

  useEffect(() => {
    if (orgId) loadCatalog(orgId);
  }, [orgId, loadCatalog]);

  // "Fill from master": match each item to the seeded national drug master and
  // back-fill only its missing salt / HSN / GST, plus set the master_item_id link.
  async function runEnrich() {
    if (!supabase || !orgId || usingSeed) return;
    setEnrichOpen(true);
    setEnrichBusy(true);
    setEnrichError(null);
    setEnrichDone(null);
    setEnrichPlan(null);
    try {
      const master = await selectAll<MasterRow>((from, to) =>
        supabase!.from("master_items").select("id,name,salt,hsn,gst_rate,schedule").range(from, to).returns<MasterRow[]>(),
      );
      setEnrichPlan(planEnrichment(items, master));
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Could not load the drug master.");
    } finally {
      setEnrichBusy(false);
    }
  }

  async function applyEnrich() {
    if (!supabase || !orgId || !enrichPlan || enrichBusy) return;
    const rows = enrichPlan;
    setEnrichBusy(true);
    setEnrichError(null);
    try {
      // Update in small concurrent batches so a large catalogue does not fan out at once.
      for (let i = 0; i < rows.length; i += 25) {
        await Promise.all(
          rows.slice(i, i + 25).map((r) => supabase!.from("items").update(r.patch).eq("id", r.itemId).eq("org_id", orgId)),
        );
      }
      await loadCatalog(orgId);
      setEnrichDone(rows.length);
      setEnrichPlan(null);
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Could not apply the changes.");
    } finally {
      setEnrichBusy(false);
    }
  }

  // Default survivor: the item carrying the most stock, then most batches, then name.
  const defaultSurvivor = (g: DuplicateGroup) =>
    [...g.items].sort(
      (a, b) => itemStock(b) - itemStock(a) || b.batches.length - a.batches.length || a.name.localeCompare(b.name),
    )[0].id;
  const survivorFor = (g: DuplicateGroup) => survivors[g.key] ?? defaultSurvivor(g);

  async function mergeGroup(g: DuplicateGroup) {
    if (!supabase || !orgId || merging) return;
    const survivorId = survivorFor(g);
    const mergedIds = g.items.map((i) => i.id).filter((id) => id !== survivorId);
    if (mergedIds.length === 0) return;
    setMerging(g.key);
    setMergeError(null);
    try {
      const { error } = await supabase.rpc("merge_items", { p_survivor: survivorId, p_merged: mergedIds });
      if (error) setMergeError(error.message);
      else await loadCatalog(orgId); // merged items disappear; the dupes list recomputes
    } finally {
      setMerging(null);
    }
  }

  const stats = useMemo(() => {
    let inStock = 0;
    let scheduled = 0;
    for (const i of items) {
      if (itemStock(i) > 0) inStock++;
      if (i.schedule !== "OTC") scheduled++;
    }
    return { total: items.length, inStock, outOfStock: items.length - inStock, scheduled };
  }, [items]);

  const dupes = useMemo(() => findDuplicateGroups(items), [items]);

  const visible = useMemo(() => {
    const base = query.trim()
      ? searchCatalog(query, items)
      : [...items].sort((a, b) => a.name.localeCompare(b.name));
    return base.filter((i) => {
      if (sched !== "All" && i.schedule !== sched) return false;
      if (ayushOnly && !i.ayush) return false;
      const qty = itemStock(i);
      if (stock === "In stock" && qty <= 0) return false;
      if (stock === "Out" && qty > 0) return false;
      return true;
    });
  }, [items, query, sched, stock, ayushOnly]);

  const columns: Column<Item>[] = [
    {
      key: "name",
      header: "Item",
      cell: (i) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-text-primary">{i.name}</span>
            {i.ayush && <AyushBadge />}
          </div>
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
          <>
            <Button
              variant="outline"
              onClick={runEnrich}
              disabled={usingSeed}
              title={usingSeed ? "Add or import your own catalogue first" : "Fill missing salt / HSN / GST from the national drug master"}
            >
              <Sparkles /> Fill from master
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PackagePlus /> New item
            </Button>
          </>
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

      {/* Possible duplicates — same name + manufacturer entered more than once.
          Pick the one to keep; merge re-points stock/sales/purchase history to it. */}
      {dupes.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Copy className="size-4 text-warning" />
            {dupes.length} possible duplicate{dupes.length > 1 ? "s" : ""} to review
          </div>
          {mergeError && <p className="mt-1 text-sm text-destructive">{mergeError}</p>}
          <div className="mt-2 space-y-2">
            {dupes.map((g) => {
              const survivorId = survivorFor(g);
              return (
                <div key={g.key} className="rounded-lg border border-warning-border bg-warning-bg/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <Badge variant="warning">{g.items.length} duplicates</Badge>
                    <span className="text-text-secondary">
                      look like <span className="font-medium">{g.label}</span> — pick the one to keep
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {g.items.map((i) => (
                      <label key={i.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`dup-${g.key}`}
                          checked={i.id === survivorId}
                          onChange={() => setSurvivors((s) => ({ ...s, [g.key]: i.id }))}
                          disabled={usingSeed || merging === g.key}
                        />
                        <Link to={`/catalogue/${i.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                          {i.name}
                        </Link>
                        <span className="hidden w-40 truncate text-right text-xs text-text-tertiary sm:block">
                          {i.manufacturer || "—"}
                        </span>
                        <span className="w-16 text-right text-xs tabular-nums text-text-tertiary">
                          {itemStock(i)} stk
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={usingSeed || merging === g.key}
                      onClick={() => mergeGroup(g)}
                    >
                      <GitMerge /> {merging === g.key ? "Merging…" : `Merge ${g.items.length} into 1`}
                    </Button>
                    <span className="text-xs text-text-tertiary">
                      {usingSeed
                        ? "Add your own catalogue to merge."
                        : "stock, sales and purchase history move to the kept item"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
        <Button
          type="button"
          size="sm"
          variant={ayushOnly ? "default" : "outline"}
          onClick={() => setAyushOnly((v) => !v)}
          title="Show only AYUSH / non-allopathic items"
        >
          AYUSH
        </Button>
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

      <Dialog open={enrichOpen} onOpenChange={setEnrichOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Fill from drug master</DialogTitle>
            <DialogDescription>
              Matches your items to the national drug master and fills only the missing salt, HSN and GST. Existing
              values are never overwritten.
            </DialogDescription>
          </DialogHeader>

          {enrichError && <p className="text-sm text-destructive">{enrichError}</p>}

          {enrichBusy && !enrichPlan ? (
            <p className="py-6 text-center text-sm text-text-tertiary">Matching against the drug master…</p>
          ) : enrichDone != null ? (
            <p className="py-6 text-center text-sm text-text-primary">
              Filled {enrichDone} item{enrichDone === 1 ? "" : "s"} from the master.
            </p>
          ) : enrichPlan ? (
            enrichPlan.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-tertiary">
                Nothing to fill — matched items are already complete, or no master matches were found (have you loaded
                the drug master?).
              </p>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  {enrichPlan.length} item{enrichPlan.length === 1 ? "" : "s"} can be enriched:
                </p>
                <div className="max-h-72 divide-y divide-divider overflow-y-auto rounded-lg border border-border">
                  {enrichPlan.slice(0, 50).map((r) => (
                    <div key={r.itemId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{r.itemName}</span>
                      <span className="shrink-0 text-xs text-text-tertiary">fill {r.fills.join(", ")}</span>
                    </div>
                  ))}
                  {enrichPlan.length > 50 && (
                    <div className="px-3 py-2 text-xs text-text-tertiary">+ {enrichPlan.length - 50} more…</div>
                  )}
                </div>
              </>
            )
          ) : null}

          <DialogFooter>
            {enrichDone != null ? (
              <Button onClick={() => setEnrichOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setEnrichOpen(false)} disabled={enrichBusy}>
                  Cancel
                </Button>
                <Button onClick={applyEnrich} disabled={enrichBusy || !enrichPlan || enrichPlan.length === 0}>
                  {enrichBusy ? "Applying…" : enrichPlan && enrichPlan.length > 0 ? `Fill ${enrichPlan.length}` : "Fill"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
