import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ArrowLeftRight, Plus, Search, X } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useInventory, type EnrichedBatch } from "@/lib/inventory";
import { useShops, useTransfers, receiveTransfer, type TransferRow } from "@/lib/transfers";
import { InventoryNav } from "./InventoryNav";

const selectCls =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-ring";

interface Line {
  batch: EnrichedBatch;
  qty: number;
}

export function TransfersPage() {
  const { shops, loading: shopsLoading } = useShops();
  const { batches, reload: reloadStock } = useInventory();
  const { rows: history, loading: histLoading, reload: reloadHistory } = useTransfers();

  const [fromShop, setFromShop] = useState("");
  const [toShop, setToShop] = useState("");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shopName = useMemo(() => new Map(shops.map((s) => [s.id, s.name])), [shops]);

  // Effective pickers: fall back to primary → first other shop until the user picks.
  const effFrom = fromShop || shops[0]?.id || "";
  const effTo = toShop && toShop !== effFrom ? toShop : (shops.find((s) => s.id !== effFrom)?.id ?? "");

  // On-hand batches in the source shop, minus those already added.
  const sourceBatches = useMemo(
    () => batches.filter((b) => b.shop_id === effFrom && b.qty > 0),
    [batches, effFrom],
  );
  const added = useMemo(() => new Set(lines.map((l) => l.batch.batch_id)), [lines]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sourceBatches
      .filter((b) => !added.has(b.batch_id))
      .filter((b) => !needle || b.name.toLowerCase().includes(needle) || (b.batch_no ?? "").toLowerCase().includes(needle))
      .slice(0, 8);
  }, [sourceBatches, added, q]);

  function changeFrom(id: string) {
    setFromShop(id);
    setLines([]); // lines are tied to the source shop
  }
  function addLine(b: EnrichedBatch) {
    setLines((ls) => [...ls, { batch: b, qty: b.qty }]);
    setQ("");
  }
  function setQty(batchId: string, n: number) {
    setLines((ls) =>
      ls.map((l) => (l.batch.batch_id === batchId ? { ...l, qty: Math.max(0, Math.min(l.batch.qty, Math.floor(n || 0))) } : l)),
    );
  }
  function removeLine(batchId: string) {
    setLines((ls) => ls.filter((l) => l.batch.batch_id !== batchId));
  }

  const valid = effFrom && effTo && effFrom !== effTo && lines.some((l) => l.qty > 0) && !busy;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      await receiveTransfer(
        effFrom,
        effTo,
        lines.filter((l) => l.qty > 0).map((l) => ({ batch_id: l.batch.batch_id, qty: l.qty })),
        notes.trim() || null,
      );
      setLines([]);
      setNotes("");
      reloadStock();
      reloadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record the transfer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="full">
      <PageHeader
        icon={ArrowLeftRight}
        title="Stock transfers"
        subtitle="Move stock between your shops — decrements the source, adds it to the destination"
      />
      <InventoryNav />

      {!shopsLoading && shops.length < 2 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Only one shop"
          hint="Add a second shop in Settings → Shops to transfer stock between branches."
        />
      ) : (
        <>
          <div className="mb-5 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-text-secondary">From</span>
                <select className={selectCls} value={effFrom} onChange={(e) => changeFrom(e.target.value)}>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <ArrowLeftRight className="mb-1.5 size-4 text-text-tertiary" />
              <label className="text-sm">
                <span className="mb-1 block text-text-secondary">To</span>
                <select className={selectCls} value={effTo} onChange={(e) => setToShop(e.target.value)}>
                  {shops
                    .filter((s) => s.id !== effFrom)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {/* Batch picker */}
            <div className="mt-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-tertiary" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a batch from the source shop…" className="pl-8" />
              </div>
              {q.trim() && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border">
                  {matches.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-text-tertiary">No matching on-hand batch in the source shop.</p>
                  ) : (
                    matches.map((b) => (
                      <button
                        key={b.batch_id}
                        type="button"
                        onClick={() => addLine(b)}
                        className="flex w-full items-center justify-between gap-2 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface"
                      >
                        <span className="min-w-0 truncate">
                          {b.name}
                          <span className="ml-1.5 text-xs text-text-tertiary">{b.batch_no ?? "—"}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-text-tertiary">{b.qty} avl</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Lines */}
            {lines.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                {lines.map((l) => (
                  <div key={l.batch.batch_id} className="flex items-center gap-2 border-b border-divider px-3 py-2 text-sm last:border-b-0">
                    <span className="min-w-0 flex-1 truncate">
                      {l.batch.name}
                      <span className="ml-1.5 text-xs text-text-tertiary">
                        {l.batch.batch_no ?? "—"} · {l.batch.qty} avl
                      </span>
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={l.batch.qty}
                      variant="cell"
                      value={l.qty}
                      onChange={(e) => setQty(l.batch.batch_id, Number(e.target.value))}
                      className="w-16 text-right"
                    />
                    <Button size="icon-xs" variant="ghost" onClick={() => removeLine(l.batch.batch_id)} aria-label="Remove">
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className="max-w-xs" />
              <Button onClick={submit} disabled={!valid}>
                <Plus /> {busy ? "Transferring…" : "Transfer stock"}
              </Button>
            </div>
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          </div>

          <DataTable<TransferRow>
            rows={history}
            rowKey={(t) => t.id}
            cols="1fr 1.6fr 0.7fr"
            loading={histLoading}
            empty={<EmptyState icon={ArrowLeftRight} title="No transfers yet" hint="Move stock between shops to see the history here." />}
            columns={[
              { key: "when", header: "When", cell: (t) => <span className="text-text-tertiary">{format(new Date(t.created_at), "d MMM, HH:mm")}</span> },
              {
                key: "route",
                header: "From → To",
                cell: (t) => (
                  <span className="inline-flex items-center gap-1.5">
                    {shopName.get(t.from_shop_id) ?? "—"}
                    <ArrowLeftRight className="size-3 text-text-tertiary" />
                    {shopName.get(t.to_shop_id) ?? "—"}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (t) => <Badge variant={t.status === "received" ? "success" : "neutral"}>{t.status}</Badge>,
              },
            ]}
          />
        </>
      )}
    </Page>
  );
}
