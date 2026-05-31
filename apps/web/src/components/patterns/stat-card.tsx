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
  hint,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "danger";
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-background p-3", className)}>
      <div className="text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">{label}</div>
      <div
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
