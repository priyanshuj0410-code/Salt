import * as React from "react";

import { cn } from "@/lib/utils";

const WIDTHS = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-5xl",
  full: "max-w-none",
} as const;

/**
 * The screen container every page returns — centered max-width, responsive
 * padding, and the density mode. Replaces the per-screen `Shell`/`<header>`;
 * lives inside AppLayout's scroll region (which owns the chrome).
 */
function Page({
  children,
  className,
  width = "md",
  density = "default",
}: {
  children: React.ReactNode;
  className?: string;
  width?: keyof typeof WIDTHS;
  density?: "compact" | "default";
}) {
  return (
    <div data-density={density} className={cn("mx-auto w-full px-4 py-5 sm:px-6", WIDTHS[width], className)}>
      {children}
    </div>
  );
}

export { Page };
