import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status dot (design.md §5.5): 6px circle, always paired with text — never color
 * alone (accessibility / color-independence). Add `pulse` only for "live".
 */
const dotVariants = cva("inline-block size-1.5 shrink-0 rounded-full", {
  variants: {
    variant: {
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-danger",
      info: "bg-info",
      neutral: "bg-text-tertiary",
      strong: "bg-text-primary",
    },
    pulse: {
      true: "animate-pulse motion-reduce:animate-none",
      false: "",
    },
  },
  defaultVariants: { variant: "neutral", pulse: false },
});

function Dot({
  className,
  variant,
  pulse,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof dotVariants>) {
  return <span data-slot="dot" aria-hidden className={cn(dotVariants({ variant, pulse }), className)} {...props} />;
}

export { Dot, dotVariants };
