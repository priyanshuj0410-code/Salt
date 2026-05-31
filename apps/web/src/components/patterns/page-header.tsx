import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * design.md §6.3 — title (+ optional icon/subtitle) on the left, actions on the
 * right. The brand mark lives in the sidebar, never here. Wraps gracefully on
 * mobile (actions drop below the title).
 */
function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-text-primary">
          {Icon && <Icon className="size-5 shrink-0 text-text-tertiary" />}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && <div className="mt-0.5 text-sm text-text-secondary">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };
