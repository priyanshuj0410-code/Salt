import { Check, Clock, ShieldAlert } from "lucide-react";
import { formatPaise } from "@/lib/currency";
import { cn } from "@/lib/utils";

/** Shape of `checkout.discountGate` — the over-limit discount approval state (SALT-206). */
export interface DiscountGate {
  over: boolean;
  status: "ok" | "needed" | "pending" | "approved" | "rejected";
  approverName: string | null;
  pct: number;
  discountPaise: number;
  maxPct: number | null;
  maxPaise: number | null;
}

/**
 * Inline checkout banner for an over-limit discount (SALT-206), mirroring the H1
 * notice. Amber while the bill needs / awaits a manager override, red if declined,
 * green once approved. Hitting Save when it is "needed" raises the request; while
 * "pending" the banner offers a Cancel. Hidden when the discount is within policy.
 */
export function DiscountApprovalNotice({ gate, onCancel }: { gate: DiscountGate; onCancel: () => void }) {
  if (!gate.over) return null;

  const approved = gate.status === "approved";
  const rejected = gate.status === "rejected";
  const pending = gate.status === "pending";
  const limitText =
    gate.maxPct !== null ? `${gate.maxPct}% limit` : gate.maxPaise !== null ? `${formatPaise(gate.maxPaise)} cap` : "limit";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
        approved
          ? "border-success-border bg-success-bg text-success"
          : rejected
            ? "border-danger-border bg-danger-bg text-danger"
            : "border-warning-border bg-warning-bg text-warning",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {approved ? (
          <Check className="size-4 shrink-0" />
        ) : pending ? (
          <Clock className="size-4 shrink-0" />
        ) : (
          <ShieldAlert className="size-4 shrink-0" />
        )}
        <span className="truncate font-medium">
          {approved
            ? `Discount approved${gate.approverName ? ` · ${gate.approverName}` : ""}`
            : pending
              ? "Waiting for manager approval…"
              : rejected
                ? "Manager declined — adjust the discount"
                : `Discount ${gate.pct.toFixed(1)}% over the ${limitText} — needs approval`}
        </span>
      </span>
      {pending && (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
