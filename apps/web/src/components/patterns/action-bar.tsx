import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/**
 * design.md / ADR 0015 — the persistent **ActionBar**: a live summary / total on
 * the left and a primary CTA on the right (+ optional secondary actions), always
 * present so the main action is one tap or keystroke away. Dual-modality: a
 * `sticky bottom-0` thumb bar on mobile, a static footer row on `md+` with a
 * `Kbd` shortcut hint on the CTA.
 *
 * The shared skeleton for simple action screens — purchase "Receive", payment
 * "Record", returns. The counter keeps its richer bespoke composition
 * (`BillSummary` / `MobileCheckout`, which add payment pickers, split tender and
 * the compliance gates); this primitive captures the shape they share.
 */
function ActionBar({
  summary,
  primary,
  secondary,
  className,
}: {
  /** Live context on the left, e.g. "3 items · ₹1,234" — any node. */
  summary: React.ReactNode;
  primary: {
    children: React.ReactNode;
    onClick: () => void;
    /** Desktop keyboard hint shown on the CTA, e.g. "F9". */
    shortcut?: string;
    busy?: boolean;
    disabled?: boolean;
    icon?: React.ReactNode;
  };
  /** Optional secondary actions (buttons) — shown on `md+` only (the mobile thumb bar stays single-action). */
  secondary?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 flex items-center gap-3 border-t border-border bg-background p-3 md:static md:z-auto",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{summary}</div>
      {secondary && <div className="hidden shrink-0 items-center gap-2 md:flex">{secondary}</div>}
      <Button
        type="button"
        size="lg"
        className="shrink-0"
        disabled={primary.disabled || primary.busy}
        onClick={primary.onClick}
      >
        {primary.icon}
        {primary.children}
        {primary.shortcut && <Kbd className="ml-1.5 hidden md:inline-flex">{primary.shortcut}</Kbd>}
      </Button>
    </div>
  );
}

export { ActionBar };
