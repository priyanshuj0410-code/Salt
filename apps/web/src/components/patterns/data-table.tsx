import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

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
  /**
   * Window the rows — only the on-screen slice is in the DOM — for 10k+ lists (SALT-154).
   * Off by default (every other table renders fully). Windowing engages only at desktop
   * width, where rows are a fixed `--row-height` (~44px); below `md` the list reflows to
   * stacked cards and renders normally. Keyboard ↑/↓ still walks the full list (it scrolls
   * to + focuses the next index), so the keyboard-first UX is unchanged.
   */
  virtualize?: boolean;
}

const ROW_PX = 44; // --row-height default; desktop rows are a single truncated line

/**
 * design.md §6.1 — sticky uppercase header, tabular numeric columns, 1px row
 * dividers, hover tint. Keyboard: ↑/↓ moves row focus, Enter activates (native
 * button). Below `md` each row reflows to a stacked label→value card.
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
  virtualize = false,
}: DataTableProps<T>) {
  const bodyRef = React.useRef<HTMLDivElement>(null);

  // Window only at desktop width — below `md` rows reflow to variable-height cards that a
  // fixed-size virtualizer would mis-position, and a phone never browses 10k unfiltered.
  const [isDesktop, setIsDesktop] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const windowed = virtualize && isDesktop && !loading && rows.length > 0;

  // Hook is always called (count 0 when not windowing) to satisfy rules-of-hooks.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns un-memoizable fns by design
  const virtualizer = useVirtualizer({
    count: windowed ? rows.length : 0,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_PX,
    overscan: 12,
  });

  function focusIndex(i: number) {
    bodyRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (rows.length === 0) return;
    e.preventDefault();
    const cur = Number((document.activeElement as HTMLElement | null)?.getAttribute?.("data-index") ?? "-1");
    const last = rows.length - 1;
    const next = cur < 0 ? 0 : e.key === "ArrowDown" ? Math.min(cur + 1, last) : Math.max(cur - 1, 0);
    if (windowed) {
      // The target row may not be mounted yet — scroll it in, then focus on the next frame.
      virtualizer.scrollToIndex(next, { align: "auto" });
      requestAnimationFrame(() => focusIndex(next));
    } else {
      focusIndex(next);
    }
  }

  const grid = { gridTemplateColumns: cols };
  const RowTag = onRowActivate ? "button" : "div";

  const renderRow = (row: T, index: number, offset?: number) => (
    <RowTag
      key={rowKey(row)}
      data-row={onRowActivate ? "" : undefined}
      data-index={index}
      onClick={onRowActivate ? () => onRowActivate(row) : undefined}
      style={
        offset === undefined
          ? grid
          : { ...grid, position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${offset}px)` }
      }
      className={cn(
        // Desktop rows read the density token (--row-height: 44px default / 36px compact).
        "flex w-full flex-col gap-1 border-b border-divider px-3 py-2 text-left text-sm last:border-b-0 md:grid md:min-h-[var(--row-height)] md:items-center md:gap-2 md:py-1.5",
        onRowActivate && "hover:bg-surface focus-visible:bg-surface focus-visible:outline-none",
      )}
    >
      {columns.map((c) => (
        <div key={c.key} className={cn("flex items-center justify-between gap-2 md:block", c.numeric && "md:text-right")}>
          <span className="text-xs text-text-tertiary md:hidden">{c.header}</span>
          <span className={cn("min-w-0 truncate", c.numeric && "tabular-nums")}>{c.cell(row)}</span>
        </div>
      ))}
    </RowTag>
  );

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
        ) : windowed ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => renderRow(rows[vi.index], vi.index, vi.start))}
          </div>
        ) : (
          rows.map((row, index) => renderRow(row, index))
        )}
      </div>
    </div>
  );
}
