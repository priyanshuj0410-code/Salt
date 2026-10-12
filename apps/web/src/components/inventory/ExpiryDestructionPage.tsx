import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Flame } from "lucide-react";
import { Page } from "@/components/patterns/page";
import { PageHeader } from "@/components/patterns/page-header";
import { StatCard } from "@/components/patterns/stat-card";
import { DataTable } from "@/components/patterns/data-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { formatPaise } from "@/lib/currency";
import { useInventory, type EnrichedBatch } from "@/lib/inventory";
import { adjustStock } from "@/lib/adjustments";
import { itcReversalPaise, printDestructionCertificate, type DestructionLine } from "@/lib/destruction";
import { InventoryNav } from "./InventoryNav";

const METHODS = ["Incineration", "Returned to manufacturer", "Deep burial", "Effluent treatment"];

export function ExpiryDestructionPage() {
  const shop = useAuth().shop;
  const { batches, loading, reload } = useInventory();
  const [includeSoon, setIncludeSoon] = useState(false);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [witnessName, setWitnessName] = useState("");
  const [witnessDesignation, setWitnessDesignation] = useState("");
  const [method, setMethod] = useState(METHODS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Expired batches with stock; optionally also those expiring within 30 days.
  const rows = useMemo(
    () =>
      batches
        .filter((b) => b.qty > 0 && b.daysToExpiry != null && (b.daysToExpiry < 0 || (includeSoon && b.daysToExpiry <= 30)))
        .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0)),
    [batches, includeSoon],
  );

  function toggle(b: EnrichedBatch) {
    setSel((s) => {
      const next = { ...s };
      if (next[b.batch_id] != null) delete next[b.batch_id];
      else next[b.batch_id] = b.qty;
      return next;
    });
  }
  function setQty(b: EnrichedBatch, n: number) {
    setSel((s) => ({ ...s, [b.batch_id]: Math.max(0, Math.min(b.qty, Math.floor(n || 0))) }));
  }

  const selected = useMemo(() => rows.filter((b) => sel[b.batch_id] != null && sel[b.batch_id] > 0), [rows, sel]);
  const totals = useMemo(() => {
    let units = 0,
      cost = 0,
      itc = 0;
    for (const b of selected) {
      const q = sel[b.batch_id];
      units += q;
      cost += q * b.ptr_paise;
      itc += itcReversalPaise(q, b.ptr_paise, b.gst_rate);
    }
    return { units, cost, itc };
  }, [selected, sel]);

  const canRecord = selected.length > 0 && witnessName.trim().length > 0 && !busy;

  async function record() {
    if (!canRecord) return;
    setBusy(true);
    setErr(null);
    const certLines: DestructionLine[] = [];
    try {
      for (const b of selected) {
        const q = sel[b.batch_id];
        const itc = itcReversalPaise(q, b.ptr_paise, b.gst_rate);
        const note = `Expiry destruction · ${method} · witness ${witnessName.trim()} · ITC reversed ${formatPaise(itc)}`;
        await adjustStock(b.batch_id, -q, "writeoff", note);
        certLines.push({
          name: b.name,
          batchNo: b.batch_no ?? "",
          expiry: b.expiryAt ? format(b.expiryAt, "MMM yyyy") : (b.expiry ?? ""),
          qty: q,
          costPaise: q * b.ptr_paise,
          itcPaise: itc,
        });
      }
      printDestructionCertificate({
        shopName: shop?.name ?? "Shop",
        shopAddress: shop?.address ?? null,
        gstin: shop?.gstin ?? null,
        dateTime: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        method,
        witnessName: witnessName.trim(),
        witnessDesignation: witnessDesignation.trim(),
        lines: certLines,
        totalUnits: totals.units,
        totalCostPaise: totals.cost,
        totalItcPaise: totals.itc,
      });
      setSel({});
      setWitnessName("");
      setWitnessDesignation("");
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record the destruction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="full">
      <PageHeader
        icon={Flame}
        title="Expiry destruction"
        subtitle="Write off expired stock with a witnessed certificate and the ITC reversal pre-computed"
      />
      <InventoryNav />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Selected batches" value={selected.length} />
        <StatCard label="Units to destroy" value={totals.units} />
        <StatCard label="Cost value" value={formatPaise(totals.cost)} hint="at PTR" />
        <StatCard label="ITC to reverse" value={formatPaise(totals.itc)} tone="danger" hint="§17(5)(h)" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-sm text-text-secondary">
          <input type="checkbox" checked={includeSoon} onChange={(e) => setIncludeSoon(e.target.checked)} />
          Also show expiring within 30 days
        </label>
      </div>

      <DataTable<EnrichedBatch>
        rows={rows}
        rowKey={(b) => b.batch_id}
        cols="0.3fr 1.6fr 0.9fr 0.6fr 0.7fr 0.9fr"
        loading={loading}
        empty={
          <EmptyState
            icon={Flame}
            title="Nothing expired"
            hint="No on-hand batch has expired. Toggle the 30-day option to destroy proactively."
          />
        }
        columns={[
          {
            key: "sel",
            header: "",
            cell: (b) => (
              <input type="checkbox" checked={sel[b.batch_id] != null} onChange={() => toggle(b)} aria-label={`Select ${b.name}`} />
            ),
          },
          {
            key: "item",
            header: "Item",
            cell: (b) => (
              <>
                {b.name}
                <span className="ml-1.5 text-xs text-text-tertiary">{b.batch_no ?? ""}</span>
              </>
            ),
          },
          {
            key: "expiry",
            header: "Expiry",
            cell: (b) => (
              <span className={cn((b.daysToExpiry ?? 0) < 0 ? "text-danger" : "text-warning")}>
                {b.expiryAt ? format(b.expiryAt, "MMM yyyy") : (b.expiry ?? "-")}
              </span>
            ),
          },
          { key: "onhand", header: "On hand", numeric: true, cell: (b) => <span className="text-text-tertiary">{b.qty}</span> },
          {
            key: "qty",
            header: "Destroy",
            numeric: true,
            cell: (b) =>
              sel[b.batch_id] != null ? (
                <Input
                  type="number"
                  min={0}
                  max={b.qty}
                  variant="cell"
                  value={sel[b.batch_id]}
                  onChange={(e) => setQty(b, Number(e.target.value))}
                  className="ml-auto w-16 text-right"
                />
              ) : (
                <span className="text-text-tertiary">-</span>
              ),
          },
          {
            key: "itc",
            header: "ITC reversal",
            numeric: true,
            cell: (b) =>
              sel[b.batch_id] != null ? (
                formatPaise(itcReversalPaise(sel[b.batch_id], b.ptr_paise, b.gst_rate))
              ) : (
                <span className="text-text-tertiary">-</span>
              ),
          },
        ]}
      />

      {/* Witness + method + commit */}
      <div className="mt-5 rounded-lg border border-border bg-background p-4">
        <div className="mb-3 text-sm font-medium text-text-primary">Destruction record</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Witness name</span>
            <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} placeholder="e.g. Drug inspector / pharmacist" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-secondary">Witness designation (optional)</span>
            <Input value={witnessDesignation} onChange={(e) => setWitnessDesignation(e.target.value)} placeholder="e.g. Drug Inspector, Zone 3" />
          </label>
        </div>
        <div className="mt-3">
          <span className="mb-1 block text-sm text-text-secondary">Method</span>
          <div className="flex flex-wrap gap-1.5">
            {METHODS.map((m) => (
              <Button key={m} size="xs" variant={method === m ? "secondary" : "outline"} onClick={() => setMethod(m)}>
                {m}
              </Button>
            ))}
          </div>
        </div>
        {err && <p className="mt-3 text-sm text-danger">{err}</p>}
        <div className="mt-4 flex items-center justify-end gap-3">
          {selected.length > 0 && !witnessName.trim() && (
            <span className="text-xs text-text-tertiary">Enter a witness name to record</span>
          )}
          <Button onClick={record} disabled={!canRecord}>
            <Flame /> {busy ? "Recording…" : "Record & print certificate"}
          </Button>
        </div>
      </div>
    </Page>
  );
}
