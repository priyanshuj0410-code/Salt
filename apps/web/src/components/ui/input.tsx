import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & { variant?: "default" | "cell" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-variant={variant}
      className={cn(
        // Height reads the density token (--input-height: 36px default / 32px compact),
        // so the [data-density] switch on <Page> actually changes input size.
        "h-[var(--input-height)] w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-border/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-border/30 dark:disabled:bg-border/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Inline table-cell editing (qty/discount): transparent, bottom-border only.
        variant === "cell" &&
          "h-7 rounded-none border-0 border-b border-input bg-transparent px-1 py-0 focus-visible:border-b-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
