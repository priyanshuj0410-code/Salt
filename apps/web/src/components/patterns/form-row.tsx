import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * design.md §6.5 — a labelled form field. Label above (`text-xs`, uppercase,
 * tertiary) → the control → helper text below (muted), which an **error**
 * replaces in `danger`.
 *
 * Renders a wrapping `<label>`, so the label is implicitly associated with its
 * control (click-to-focus, no id wiring) and **tab order follows visual order**.
 * Stacks vertically (mobile-first); pair with touch-sized controls. Drop a
 * single control in as children:
 *
 * ```tsx
 * <FormRow label="Shop name" required><Input … /></FormRow>
 * <FormRow label="GSTIN" error={err}><Input … /></FormRow>
 * ```
 */
function FormRow({
  label,
  required,
  helper,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  /** Muted helper text below the control. Hidden when `error` is set. */
  helper?: React.ReactNode;
  /** Replaces the helper text, in `danger`, and announces via role="alert". */
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium tracking-wide text-text-tertiary uppercase">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : helper ? (
        <span className="text-xs text-text-tertiary">{helper}</span>
      ) : null}
    </label>
  );
}

export { FormRow };
