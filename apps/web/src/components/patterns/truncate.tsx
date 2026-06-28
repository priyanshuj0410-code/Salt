import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * design.md — text must never overflow silently. Renders single-line truncated
 * text (ellipsis) and exposes the full value as a native tooltip, but ONLY when
 * the text is actually clipped — so a value is always recoverable on hover
 * without adding a redundant tooltip to every short label.
 *
 * Overflow is measured lazily on hover (no ResizeObserver / mount work), so this
 * is cheap to use in dense tables with hundreds of rows. The parent must
 * constrain the width (a flex item needs `min-w-0`, a grid/table cell already
 * does). Pass the full string as `text`; it is both rendered and used as the tooltip.
 */
function Truncate({ text, className }: { text: string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [title, setTitle] = React.useState<string | undefined>(undefined);

  return (
    <span
      ref={ref}
      title={title}
      onMouseEnter={() => {
        const el = ref.current;
        if (el) setTitle(el.scrollWidth > el.clientWidth ? text : undefined);
      }}
      className={cn("block truncate", className)}
    >
      {text}
    </span>
  );
}

export { Truncate };
