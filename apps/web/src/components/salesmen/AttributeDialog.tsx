import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/currency";
import {
  assignInvoices,
  assignPayments,
  listUnassignedInvoices,
  listUnassignedPayments,
} from "@/lib/salesmen";

type Kind = "orders" | "collections";

interface Candidate {
  id: string;
  title: string;
  party: string;
  date: string;
  amountPaise: number;
}

/**
 * Attribute existing orders / collections that have no salesman yet to this
 * salesman. The natural capture point is bill / receipt entry (owned by the
 * billing + payments modules — tickets filed), so this back-fills attribution
 * and keeps the report meaningful today. A direct, RLS-guarded update on
 * `salesman_id`; nothing else about the document changes.
 */
export function AttributeDialog({
  kind,
  salesmanId,
  salesmanName,
  orgId,
  open,
  onOpenChange,
  onDone,
}: {
  kind: Kind;
  salesmanId: string;
  salesmanName: string;
  orgId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orgId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setPicked(new Set());
      setError(null);
      try {
        let cands: Candidate[];
        if (kind === "orders") {
          const xs = await listUnassignedInvoices(orgId);
          cands = xs.map((x) => ({
            id: x.id,
            title: x.invoice_no ?? "(no number)",
            party: x.ledgers?.name ?? "Walk-in",
            date: x.invoice_date,
            amountPaise: x.total_paise,
          }));
        } else {
          const xs = await listUnassignedPayments(orgId);
          cands = xs.map((x) => ({
            id: x.id,
            title: x.mode.toUpperCase(),
            party: x.ledgers?.name ?? "-",
            date: x.payment_date,
            amountPaise: x.amount_paise,
          }));
        }
        if (active) setRows(cands);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, orgId, kind]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPicked = rows.length > 0 && picked.size === rows.length;
  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function assign() {
    if (busy || picked.size === 0) return;
    setBusy(true);
    setError(null);
    const ids = [...picked];
    try {
      if (kind === "orders") await assignInvoices(ids, salesmanId);
      else await assignPayments(ids, salesmanId);
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign.");
    } finally {
      setBusy(false);
    }
  }

  const noun = kind === "orders" ? "orders" : "collections";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attribute {noun} to {salesmanName}</DialogTitle>
          <DialogDescription>
            Recent {noun} with no salesman set. Tick the ones {salesmanName} handled, then assign.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="px-1 py-6 text-sm text-text-tertiary">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-1 py-6 text-sm text-text-tertiary">
            No unattributed {noun} in the last few months.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={toggleAll}
              className="flex w-full items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-left text-xs font-medium text-text-secondary"
            >
              <input type="checkbox" readOnly checked={allPicked} className="size-3.5 accent-primary" />
              {allPicked ? "Clear all" : "Select all"} ({rows.length})
            </button>
            <div className="max-h-[40vh] overflow-y-auto">
              {rows.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-divider px-3 py-2 text-sm last:border-b-0 hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{r.title}</span>
                    <span className="ml-1.5 text-text-tertiary">{r.party}</span>
                  </span>
                  <span className="shrink-0 text-text-tertiary">{format(parseISO(r.date), "d MMM")}</span>
                  <span className="w-24 shrink-0 text-right tabular-nums">{formatPaise(r.amountPaise)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={assign} disabled={busy || picked.size === 0}>
            {busy ? "Assigning…" : `Assign ${picked.size || ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
