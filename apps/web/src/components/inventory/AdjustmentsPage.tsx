import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useInventory, type EnrichedBatch } from "@/lib/inventory";
import {
  ADJUST_KINDS,
  adjustStock,
  adjustmentNote,
  useAdjustmentLog,
  type AdjustKind,
} from "@/lib/adjustments";
import { InventoryNav } from "./InventoryNav";

function AdjustDialog({
  open,
  onOpenChange,
  batches,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  batches: EnrichedBatch[];
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [batch, setBatch] = useState<EnrichedBatch | null>(null);
  const [kind, setKind] = useState<AdjustKind>(ADJUST_KINDS[0]);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return batches
      .filter((b) => b.qty > 0)
      .filter((b) => !needle || b.name.toLowerCase().includes(needle) || (b.batch_no ?? "").toLowerCase().includes(needle))
      .slice(0, 8);
  }, [batches, q]);

  const n = Number(qty);
  const valid = batch && Number.isInteger(n) && n > 0 && (kind.sign > 0 || n <= (batch?.qty ?? 0));
  const delta = batch ? kind.sign * n : 0;

  function reset() {
    setQ("");
    setBatch(null);
    setKind(ADJUST_KINDS[0]);
    setQty("");
    setNote("");
    setErr(null);
  }

  async function apply() {
    if (!batch || !valid) return;
    setSaving(true);
    setErr(null);
    try {
      await adjustStock(batch.batch_id, delta, kind.dbReason, adjustmentNote(kind, note));
      reset();
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the adjustment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record stock adjustment</DialogTitle>
        </DialogHeader>

        {/* Batch picker */}
        {!batch ? (
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-tertiary" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or batch…" className="pl-8" />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
              {matches.length === 0 ? (
                <p className="px-3 py-4 text-sm text-text-tertiary">No on-hand batch matches.</p>
              ) : (
                matches.map((b) => (
                  <button
                    key={b.batch_id}
                    type="button"
                    onClick={() => setBatch(b)}
                    className="flex w-full items-center justify-between gap-2 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="truncate">{b.name}</span>
                      <span className="ml-1.5 text-xs text-text-tertiary">{b.batch_no ?? "-"}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-text-tertiary">{b.qty} on hand</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="truncate font-medium">{batch.name}</span>
              <span className="ml-1.5 text-xs text-text-tertiary">
                {batch.batch_no ?? "-"} · {batch.qty} on hand
              </span>
            </span>
            <Button size="xs" variant="ghost" onClick={() => setBatch(null)}>
              Change
            </Button>
          </div>
        )}

        {/* Reason + qty */}
        {batch && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {ADJUST_KINDS.map((k) => (
                <Button key={k.key} size="xs" variant={kind.key === k.key ? "secondary" : "outline"} onClick={() => setKind(k)}>
                  {k.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-text-secondary">Qty</span>
                <Input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-24"
                  placeholder="0"
                />
              </label>
              {Number.isInteger(n) && n > 0 && (
                <span className={cn("text-sm tabular-nums", kind.sign < 0 ? "text-danger" : "text-success")}>
                  {kind.sign < 0 ? "−" : "+"}
                  {n} → {Math.max(0, batch.qty + delta)} on hand
                </span>
              )}
            </div>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): e.g. broken in transit" />
            {kind.sign < 0 && Number.isInteger(n) && n > batch.qty && (
              <p className="text-xs text-danger">Cannot remove more than the {batch.qty} on hand.</p>
            )}
          </div>
        )}

        {err && <p className="text-sm text-danger">{err}</p>}

        <DialogFooter showCloseButton>
          <Button onClick={apply} disabled={!valid || saving}>
            {saving ? "Saving…" : "Apply adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustmentsPage() {
  const { batches, reload: reloadStock } = useInventory();
  const { rows, loading, reload: reloadLog } = useAdjustmentLog();
  const [open, setOpen] = useState(false);

  // Net write-off value over the visible log, valued at cost (PTR is not on the
  // movement here, so this counts movements; value detail lives on each batch).
  const writeoffs = useMemo(() => rows.filter((r) => r.reason === "writeoff").length, [rows]);

  return (
    <Page width="lg">
      <PageHeader
        icon={SlidersHorizontal}
        title="Stock adjustments"
        subtitle="Breakage, theft, write-offs and count corrections. Each leaves an audit trail"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Record adjustment
          </Button>
        }
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Adjustments logged" value={rows.length} hint="most recent 100" />
        <StatCard label="Write-offs" value={writeoffs} tone={writeoffs > 0 ? "danger" : "default"} />
        <StatCard label="Batches on hand" value={batches.filter((b) => b.qty > 0).length} />
      </div>

      <DataTable<(typeof rows)[number]>
        rows={rows}
        rowKey={(r) => r.id}
        cols="1fr 1.6fr 0.7fr 1.4fr"
        loading={loading}
        empty={
          <EmptyState
            icon={SlidersHorizontal}
            title="No adjustments yet"
            hint="Record a breakage, theft or count correction to start the audit trail."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                <Plus /> Record adjustment
              </Button>
            }
          />
        }
        columns={[
          {
            key: "when",
            header: "When",
            cell: (r) => <span className="text-text-tertiary">{format(new Date(r.created_at), "d MMM, HH:mm")}</span>,
          },
          {
            key: "item",
            header: "Item",
            cell: (r) => (
              <>
                {r.item?.name ?? "-"}
                <span className="ml-1.5 text-xs text-text-tertiary">{r.batch?.batch_no ?? ""}</span>
              </>
            ),
          },
          {
            key: "qty",
            header: "Qty",
            numeric: true,
            cell: (r) => (
              <span className={cn("font-medium tabular-nums", r.qty_delta < 0 ? "text-danger" : "text-success")}>
                {r.qty_delta > 0 ? `+${r.qty_delta}` : r.qty_delta}
              </span>
            ),
          },
          {
            key: "reason",
            header: "Reason",
            cell: (r) => (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Badge variant={r.reason === "writeoff" ? "danger" : "neutral"}>{r.reason}</Badge>
                <span className="truncate text-xs text-text-tertiary">{r.note ?? ""}</span>
              </span>
            ),
          },
        ]}
      />

      <AdjustDialog
        open={open}
        onOpenChange={setOpen}
        batches={batches}
        onDone={() => {
          reloadStock();
          reloadLog();
        }}
      />
    </Page>
  );
}
