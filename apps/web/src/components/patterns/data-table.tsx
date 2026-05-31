import * as React from "react";

import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Right-align + tabular figures (money / qty / counts). */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Desktop grid-template-columns, e.g. "1fr 1.4fr 0.8fr 0.9fr 0.9fr". */
  cols: string;
  onRowActivate?: (row: T) => void;
  loading?: boolean;
  empty?: React.ReactNode;
  maxHeight?: string;
}

/**
 * design.md §6.1 — sticky uppercase header, tabular numeric columns, 1px row
 * dividers, hover tint. Keyboard: ↑/↓ moves row focus, Enter activates (native
 * button). Below `md` each row reflows to a stacked label→value card (no
 * horizontal scroll for key data); the keyboard nav is desktop-first.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  cols,
  onRowActivate,
  loading,
  empty,
  maxHeight = "64vh",
}: DataTableProps<T>) {
  const bodyRef = React.useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(bodyRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? []);
    if (!btns.length) return;
    e.preventDefault();
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i < 0 ? 0 : Math.min(i + 1, btns.length - 1)) : Math.max(i - 1, 0);
    btns[next]?.focus();
  }

  const grid = { gridTemplateColumns: cols };
  const RowTag = onRowActivate ? "button" : "div";

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Header — desktop only */}
      <div
        style={grid}
        className="hidden gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase md:grid"
      >
        {columns.map((c) => (
          <span key={c.key} className={cn("truncate", c.numeric && "text-right")}>
            {c.header}
          </span>
        ))}
      </div>

      <div ref={bodyRef} onKeyDown={onKeyDown} className="overflow-y-auto" style={{ maxHeight }}>
        {loading ? (
          <p className="px-3 py-6 text-sm text-text-tertiary">Loading…</p>
        ) : rows.length === 0 ? (
          (empty ?? <p className="px-3 py-6 text-sm text-text-tertiary">Nothing here yet.</p>)
        ) : (
          rows.map((row) => (
            <RowTag
              key={rowKey(row)}
              data-row={onRowActivate ? "" : undefined}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
              style={grid}
              className={cn(
                "flex w-full flex-col gap-1 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 md:grid md:items-center md:gap-2 md:py-1.5",
                onRowActivate && "hover:bg-surface focus-visible:bg-surface focus-visible:outline-none",
              )}
            >
              {columns.map((c) => (
                <div
                  key={c.key}
                  className={cn(
                    "flex items-center justify-between gap-2 md:block",
                    c.numeric && "md:text-right",
                  )}
                >
                  <span className="text-xs text-text-tertiary md:hidden">{c.header}</span>
                  <span className={cn("min-w-0 truncate", c.numeric && "tabular-nums")}>{c.cell(row)}</span>
                </div>
              ))}
            </RowTag>
          ))
        )}
      </div>
    </div>
  );
}
