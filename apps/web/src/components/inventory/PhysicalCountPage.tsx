import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, ClipboardCheck, Plus } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useInventory } from "@/lib/inventory";
import {
  createPhysicalCount,
  finalizePhysicalCount,
  saveCountedQty,
  type CountLine,
  type PhysicalCount,
} from "@/lib/physicalCount";
import { InventoryNav } from "./InventoryNav";

/** The editable / read-only count sheet for one count. */
function CountSheet({ count, onBack, onFinalized }: { count: PhysicalCount; onBack: () => void; onFinalized: () => void }) {
  const orgId = useAuth().membership?.orgId;
  const [lines, setLines] = useState<CountLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const draft = count.status === "draft";

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("physical_count_lines")
      .select("id,item_id,batch_id,system_qty,counted_qty,variance,item:items(name),batch:batches(batch_no)")
      .eq("count_id", count.id)
      .then(({ data }) => {
        if (!active) return;
        setLines((data as unknown as CountLine[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, count.id]);

  function setCounted(id: string, val: number) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, counted_qty: val, variance: val - l.system_qty } : l)));
    setDirty((d) => new Set(d).add(id));
  }

  const variances = useMemo(() => lines.filter((l) => l.variance !== 0), [lines]);
  const netUnits = useMemo(() => lines.reduce((s, l) => s + l.variance, 0), [lines]);

  async function persistDirty() {
    for (const l of lines) if (dirty.has(l.id)) await saveCountedQty(l.id, l.counted_qty);
    setDirty(new Set());
  }

  async function finalize() {
    setBusy(true);
    setErr(null);
    try {
      await persistDirty();
      await finalizePhysicalCount(count.id);
      onFinalized();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not finalize the count");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await persistDirty();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        title={`Count · ${format(new Date(count.count_date), "d MMM yyyy")}`}
        subtitle={draft ? "Enter the counted quantity for each batch, then finalize to reconcile" : "Finalized — variances posted as adjustments"}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft /> Back
            </Button>
            {draft && (
              <>
                <Button variant="outline" size="sm" onClick={save} disabled={busy || dirty.size === 0}>
                  Save
                </Button>
                <Button size="sm" onClick={finalize} disabled={busy}>
                  {busy ? "Finalizing…" : "Finalize count"}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Lines" value={lines.length} />
        <StatCard label="With variance" value={variances.length} tone={variances.length > 0 ? "danger" : "default"} />
        <StatCard label="Net variance" value={`${netUnits > 0 ? "+" : ""}${netUnits} units`} />
      </div>

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <DataTable<CountLine>
        rows={lines}
        rowKey={(l) => l.id}
        cols="1.8fr 0.9fr 0.7fr 0.8fr 0.7fr"
        loading={loading}
        empty={<EmptyState icon={ClipboardCheck} title="No lines" hint="This count has no batches snapshotted." />}
        columns={[
          {
            key: "item",
            header: "Item",
            cell: (l) => (
              <>
                {l.item?.name ?? "—"}
                <span className="ml-1.5 text-xs text-text-tertiary">{l.batch?.batch_no ?? ""}</span>
              </>
            ),
          },
          { key: "batch", header: "Batch", cell: (l) => <span className="text-text-tertiary">{l.batch?.batch_no ?? "—"}</span> },
          { key: "system", header: "System", numeric: true, cell: (l) => <span className="text-text-tertiary">{l.system_qty}</span> },
          {
            key: "counted",
            header: "Counted",
            numeric: true,
            cell: (l) =>
              draft ? (
                <Input
                  type="number"
                  min={0}
                  variant="cell"
                  value={l.counted_qty}
                  onChange={(e) => setCounted(l.id, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="ml-auto w-16 text-right"
                />
              ) : (
                l.counted_qty
              ),
          },
          {
            key: "var",
            header: "Variance",
            numeric: true,
            cell: (l) => (
              <span className={cn("tabular-nums", l.variance < 0 ? "text-danger" : l.variance > 0 ? "text-success" : "text-text-tertiary")}>
                {l.variance > 0 ? `+${l.variance}` : l.variance}
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

export function PhysicalCountPage() {
  const orgId = useAuth().membership?.orgId;
  const shopId = useAuth().shop?.id;
  const { batches, reload: reloadStock } = useInventory();
  const [counts, setCounts] = useState<PhysicalCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reloadCounts = useCallback(() => setNonce((n) => n + 1), []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("physical_counts")
      .select("id,count_date,status,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!active) return;
        setCounts((data as unknown as PhysicalCount[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, nonce]);

  const active = useMemo(() => counts.find((c) => c.id === activeId) ?? null, [counts, activeId]);

  async function newCount() {
    if (!orgId || !shopId) {
      setErr("Set up your shop before starting a count.");
      return;
    }
    const snap = batches.filter((b) => b.qty > 0).map((b) => ({ item_id: b.item_id, batch_id: b.batch_id, qty: b.qty }));
    setBusy(true);
    setErr(null);
    try {
      const id = await createPhysicalCount(orgId, shopId, snap);
      reloadCounts();
      setActiveId(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start the count");
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <Page width="full">
        <InventoryNav />
        <CountSheet
          count={active}
          onBack={() => setActiveId(null)}
          onFinalized={() => {
            reloadStock();
            reloadCounts();
            setActiveId(null);
          }}
        />
      </Page>
    );
  }

  return (
    <Page width="lg">
      <PageHeader
        icon={ClipboardCheck}
        title="Physical count"
        subtitle="Stock-take: snapshot on-hand, enter counted quantities, reconcile the variance"
        actions={
          <Button onClick={newCount} disabled={busy}>
            <Plus /> {busy ? "Starting…" : "New count"}
          </Button>
        }
      />
      <InventoryNav />

      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <DataTable<PhysicalCount>
        rows={counts}
        rowKey={(c) => c.id}
        cols="1fr 1fr 0.6fr"
        loading={loading}
        onRowActivate={(c) => setActiveId(c.id)}
        empty={
          <EmptyState
            icon={ClipboardCheck}
            title="No counts yet"
            hint="Start a count to snapshot current on-hand stock and reconcile against a physical count."
            action={
              <Button size="sm" onClick={newCount} disabled={busy}>
                <Plus /> New count
              </Button>
            }
          />
        }
        columns={[
          { key: "date", header: "Count date", cell: (c) => format(new Date(c.count_date), "d MMM yyyy") },
          {
            key: "status",
            header: "Status",
            cell: (c) => <Badge variant={c.status === "finalized" ? "success" : "neutral"}>{c.status}</Badge>,
          },
          { key: "open", header: "", numeric: true, cell: (c) => <span className="text-text-tertiary">{c.status === "draft" ? "Continue →" : "View →"}</span> },
        ]}
      />
    </Page>
  );
}
