import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * design.md §6.2 — label (xs uppercase) → big tabular value → optional hint.
 * The number is the focus; no decorative icons. `tone` colours the value for
 * money state (receivable/payable), never for category.
 */
function StatCard({
  label,
  value,
  valueTitle,
  hint,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Full value shown on hover when `value` is compacted (e.g. ₹12.3K → ₹12,345.00). */
  valueTitle?: string;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-3", className)}>
      <div className="text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">{label}</div>
      <div
        title={valueTitle}
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
          tone === "default" && "text-text-primary",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-text-tertiary">{hint}</div>}
    </div>
  );
}

export { StatCard };
