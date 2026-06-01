import { AlertTriangle } from "lucide-react";
import { formatPaise } from "@/lib/currency";
import type { CreditCheck } from "@/lib/credit";

/**
 * Amber, **non-blocking** warning at checkout when a credit sale would push the bound
 * customer over their credit limit (SALT-004). The cashier can still save — it informs,
 * it does not gate. Shown only when `check.over` (credit method + limit set + exceeded).
 */
export function CreditNotice({ check }: { check: CreditCheck }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <strong>Over credit limit by {formatPaise(check.overByPaise)}.</strong>{" "}
        <span className="text-xs">
          Dues {formatPaise(check.duePaise)} + this bill = {formatPaise(check.projectedPaise)} · limit{" "}
          {formatPaise(check.limitPaise)}
        </span>
      </span>
    </div>
  );
}
