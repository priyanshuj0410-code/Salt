import * as React from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

const TONE = {
  info: "bg-info-bg text-info",
  neutral: "bg-surface-2 text-text-secondary",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
} as const;

/**
 * design.md / ADR 0015 — the "what this is for" **context bar**: an icon chip, a
 * small caption + the entity name, one optional key attribute (dues / balance /
 * phone), and a change affordance (a `Kbd` hint on desktop, tap on mobile).
 *
 * Generalises the counter's bespoke `CustomerBar` so the party-profile and
 * vendor (purchase-entry) headers share one primitive. Full-width and tappable
 * on mobile; a compact chip on desktop. Renders as a `<button>` when `onChange`
 * is given (the whole bar is the change target), else a static `<div>` (e.g. a
 * profile header you do not change in place).
 */
function EntityHeader({
  icon: Icon,
  label,
  name,
  attribute,
  onChange,
  shortcut,
  tone = "info",
  className,
}: {
  icon: LucideIcon;
  /** Small caption above the name, e.g. "Billing to". */
  label?: React.ReactNode;
  /** The entity name (prominent, truncates). */
  name: React.ReactNode;
  /** One key attribute shown inline, e.g. dues / balance / phone. */
  attribute?: React.ReactNode;
  /** When set, the whole bar is a button that fires this (e.g. open the picker). */
  onChange?: () => void;
  /** Desktop keyboard hint next to the change affordance, e.g. "Ctrl K". */
  shortcut?: string;
  /** Icon-chip colour. */
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const interactive = onChange != null;
  const base = "flex items-center gap-2.5 rounded-lg bg-surface-2 px-3 py-2 text-left md:py-1.5";

  const content = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full md:size-6",
          TONE[tone],
        )}
      >
        <Icon className="size-4 md:size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        {label != null && (
          <span className="block text-[11px] leading-tight text-text-tertiary">{label}</span>
        )}
        <span className="block truncate text-sm leading-tight font-medium text-text-primary">{name}</span>
      </span>
      {attribute != null && <span className="shrink-0 text-xs text-text-tertiary">{attribute}</span>}
      {interactive && shortcut && (
        <span className="hidden shrink-0 items-center text-text-tertiary md:flex">
          <Kbd>{shortcut}</Kbd>
        </span>
      )}
      {interactive && <ChevronDown className="size-4 shrink-0 text-text-tertiary" />}
    </>
  );

  if (!interactive) {
    return <div className={cn(base, className)}>{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={onChange}
      title={shortcut ? `Change (${shortcut})` : "Change"}
      className={cn(base, "hover:bg-border", className)}
    >
      {content}
    </button>
  );
}

export { EntityHeader };
