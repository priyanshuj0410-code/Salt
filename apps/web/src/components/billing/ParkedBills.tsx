import { Clock, X } from "lucide-react";
import { formatPaise } from "@/lib/currency";
import { useAuth } from "@/lib/auth";
import { billTotals } from "@/store/bill";
import { useHeldBills } from "@/store/heldBills";

/**
 * The held-bills strip — one chip per bill set aside on this shop (SALT-191B, server-backed via
 * `useHeldBills`). Tap a chip to resume it (the in-progress bill is held in its place); tap the ×
 * to discard. Holds are shared across counters and survive refresh; the list is kept live by the
 * realtime subscription wired in `BillingScreen`. Hidden when nothing is held.
 */
export function ParkedBills() {
  const shopId = useAuth().shopId;
  const held = useHeldBills((s) => s.held);
  const resume = useHeldBills((s) => s.resume);
  const discard = useHeldBills((s) => s.discard);

  if (held.length === 0) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface-2 px-3 py-2 md:px-4">
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-text-tertiary">
        <Clock className="size-3.5" /> Held ({held.length})
      </span>
      {held.map((h) => {
        const t = billTotals(h.lines, h.billDiscount);
        return (
          <div
            key={h.id}
            className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-background py-1 pl-2.5 pr-1.5 text-sm"
          >
            <button
              onClick={() => shopId && resume(shopId, h.id)}
              className="flex items-center gap-1.5 text-left"
              title="Resume this bill"
            >
              <span className="font-medium">{h.label}</span>
              <span className="text-xs text-text-tertiary">
                {t.items} item{t.items !== 1 ? "s" : ""} · {formatPaise(t.grand)}
              </span>
            </button>
            <button
              onClick={() => discard(h.id)}
              aria-label={`Discard held bill for ${h.label}`}
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
