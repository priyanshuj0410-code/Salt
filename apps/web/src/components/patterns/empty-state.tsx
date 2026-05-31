import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * design.md §6.4 — icon in a surface-2 circle, short title, short hint, optional
 * action. Replaces the tbody content, not the whole card. Never overdesign.
 */
function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      {Icon && (
        <div className="flex size-9 items-center justify-center rounded-full bg-surface-2">
          <Icon className="size-4 text-text-tertiary" />
        </div>
      )}
      <div className="text-sm font-medium text-text-primary">{title}</div>
      {hint && <div className="max-w-xs text-xs text-text-tertiary">{hint}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export { EmptyState };
