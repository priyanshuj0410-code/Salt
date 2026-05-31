import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Keyboard hint (design.md §5.4): ~20px tall, monospace, surface-2 background,
 * 2px bottom-border for a recessed look. Every shortcut shows one inline —
 * tooltip-only shortcuts are banned. Hidden below `md` (no physical keyboard on
 * touch), so it's progressive enhancement, not noise on mobile.
 *
 * Inside a dark/primary button the parent restyles it (see button.tsx) to a
 * translucent-white treatment.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "hidden h-5 min-w-5 select-none items-center justify-center rounded-sm border-b-2 border-border-strong bg-surface-2 px-1 font-mono text-[0.6875rem] leading-none font-medium text-text-secondary md:inline-flex",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
