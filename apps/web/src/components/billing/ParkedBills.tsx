import { Clock, X } from "lucide-react";
import { formatPaise } from "@/lib/currency";
import { billTotals, useBill } from "@/store/bill";

/**
 * The held-bills strip — one chip per bill set aside on this counter (SALT-008).
 * Tap a chip to resume it (the in-progress bill is held in its place); tap the ×
 * to discard. Hidden when nothing is held. Local/in-memory for now — cross-counter
 * handoff + refresh-persistence are follow-ups (see the ticket).
 */
export function ParkedBills() {
  const parked = useBill((s) => s.parked);
  const resume = useBill((s) => s.resumeBill);
  const discard = useBill((s) => s.discardPark);

  if (parked.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface-2 px-3 py-2 md:px-4">
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-text-tertiary">
        <Clock className="size-3.5" /> Held ({parked.length})
      </span>
      {parked.map((p) => {
        const t = billTotals(p.lines);
        return (
          <div
            key={p.id}
            className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background py-1 pl-2.5 pr-1.5 text-sm"
          >
            <button
              onClick={() => resume(p.id)}
              className="flex items-center gap-1.5 text-left"
              title="Resume this bill"
            >
              <span className="font-medium">{p.label}</span>
              <span className="text-xs text-text-tertiary">
                {t.items} item{t.items !== 1 ? "s" : ""} · {formatPaise(t.grand)}
              </span>
            </button>
            <button
              onClick={() => discard(p.id)}
              aria-label={`Discard held bill for ${p.label}`}
              className="text-text-tertiary hover:text-destructive"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
