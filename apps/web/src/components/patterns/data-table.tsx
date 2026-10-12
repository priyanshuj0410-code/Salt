import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Right-align + tabular figures (money / qty / counts). */
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
  /** Make the header a sort toggle (asc → desc → off). Needs `sortValue`. */
  sortable?: boolean;
  /** Comparison key for sorting — string sorts by locale, number numerically. */
  sortValue?: (row: T) => string | number;
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

type SortState = { key: string; dir: "asc" | "desc" } | null;

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
  const [sort, setSort] = React.useState<SortState>(null);

  // Client-side sort, opt-in per column. Default null → rows render as given, so
  // callers that pre-sort are unaffected until a header is clicked. Only the
  // active-sort path pays the O(n log n); the null path returns immediately.
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const sv = columns.find((c) => c.key === sort.key)?.sortValue;
    if (!sv) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

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

  const windowed = virtualize && isDesktop && !loading && sortedRows.length > 0;

  // Hook is always called (count 0 when not windowing) to satisfy rules-of-hooks.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns un-memoizable fns by design
  const virtualizer = useVirtualizer({
    count: windowed ? sortedRows.length : 0,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_PX,
    overscan: 12,
  });

  function focusIndex(i: number) {
    bodyRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (sortedRows.length === 0) return;
    e.preventDefault();
    const cur = Number((document.activeElement as HTMLElement | null)?.getAttribute?.("data-index") ?? "-1");
    const last = sortedRows.length - 1;
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
        onRowActivate && "hover:bg-surface focus-visible:bg-surface focus-visible:-outline-offset-2",
      )}
    >
      {columns.map((c) => (
        // `min-w-0` lets the grid track shrink below its content — a long unbreakable
        // string (file name, GSTIN) otherwise forces the track wide and overflows the
        // card. The inner block then truncates with an ellipsis. Cells that render
        // interactive content (a button/link) must wrap their long text in its own
        // `truncate` span — see the "File" column in ScanQueue.
        <div key={c.key} className={cn("flex min-w-0 items-center justify-between gap-2 md:block", c.numeric && "md:text-right")}>
          <span className="text-xs text-text-tertiary md:hidden">{c.header}</span>
          <span className={cn("block min-w-0 truncate", c.numeric && "tabular-nums")}>{c.cell(row)}</span>
        </div>
      ))}
    </RowTag>
  );

  // Loading placeholder — mirrors the column grid so the layout never jumps.
  const renderSkeleton = (i: number) => (
    <div
      key={i}
      style={grid}
      className="hidden gap-2 border-b border-divider px-3 last:border-b-0 md:grid md:min-h-[var(--row-height)] md:items-center"
    >
      {columns.map((c) => (
        <div key={c.key} className={cn("h-3 animate-pulse rounded bg-surface-2", c.numeric ? "ml-auto w-12" : "w-2/3")} />
      ))}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Header — desktop only */}
      <div
        style={grid}
        className="hidden gap-2 border-b border-border bg-surface px-3 py-2 text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase md:grid"
      >
        {columns.map((c) => {
          const active = sort?.key === c.key;
          if (!c.sortable) {
            return (
              <span key={c.key} className={cn("block min-w-0 truncate", c.numeric && "text-right")}>
                {c.header}
              </span>
            );
          }
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggleSort(c.key)}
              className={cn(
                "flex min-w-0 items-center gap-1 uppercase tracking-wide hover:text-text-secondary",
                c.numeric ? "justify-end" : "justify-start",
                active && "text-text-secondary",
              )}
            >
              {c.numeric && <SortCaret active={active} dir={sort?.dir} />}
              <span className="truncate">{c.header}</span>
              {!c.numeric && <SortCaret active={active} dir={sort?.dir} />}
            </button>
          );
        })}
      </div>

      <div ref={bodyRef} onKeyDown={onKeyDown} className="overflow-y-auto" style={{ maxHeight }}>
        {loading ? (
          <>
            <p className="px-3 py-3 text-sm text-text-tertiary md:hidden">Loading…</p>
            {Array.from({ length: 8 }, (_, i) => renderSkeleton(i))}
          </>
        ) : sortedRows.length === 0 ? (
          (empty ?? (
            // Neutral single line — correct for both a genuinely-empty table and a
            // filtered view with no matches. Call sites pass a richer `empty` when wanted.
            <div className="px-3 py-12 text-center text-sm text-text-tertiary">Nothing here yet.</div>
          ))
        ) : windowed ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => renderRow(sortedRows[vi.index], vi.index, vi.start))}
          </div>
        ) : (
          sortedRows.map((row, index) => renderRow(row, index))
        )}
      </div>
    </div>
  );
}

/** Sort affordance on a sortable header: faint two-way chevron when idle, a single
 *  chevron in the active direction when sorting by this column. */
function SortCaret({ active, dir }: { active: boolean; dir?: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="size-3 shrink-0 opacity-40" />;
  return dir === "asc" ? <ChevronUp className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />;
}
