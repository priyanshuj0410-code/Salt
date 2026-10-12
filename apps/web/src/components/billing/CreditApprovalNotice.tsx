import { Check, Clock, ShieldAlert } from "lucide-react";
import { formatPaise } from "@/lib/currency";
import { cn } from "@/lib/utils";

/** Shape of `checkout.creditGate` — the over-limit credit-sale approval state (SALT-175). */
export interface CreditGate {
  over: boolean;
  status: "ok" | "needed" | "pending" | "approved" | "rejected";
  approverName: string | null;
  grandPaise: number;
  duePaise: number;
  limitPaise: number;
}

/**
 * Inline checkout banner for a credit sale over the customer's limit (SALT-175), mirroring the
 * discount-approval notice. Amber while the bill needs / awaits a manager override, red if
 * declined, green once approved. Hitting Save when "needed" raises the request; while "pending"
 * the banner offers a Cancel. Hidden when the credit sale is within limit.
 */
export function CreditApprovalNotice({ gate, onCancel }: { gate: CreditGate; onCancel: () => void }) {
  if (!gate.over) return null;

  const approved = gate.status === "approved";
  const rejected = gate.status === "rejected";
  const pending = gate.status === "pending";

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
            ? `Credit approved${gate.approverName ? ` · ${gate.approverName}` : ""}`
            : pending
              ? "Waiting for manager approval…"
              : rejected
                ? "Manager declined: take payment or reduce the bill"
                : `Credit over the ${formatPaise(gate.limitPaise)} limit: needs approval`}
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
