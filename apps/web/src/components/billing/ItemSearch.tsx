import { useEffect, useMemo, useRef, useState } from "react";
import { ScheduleBadge } from "./ScheduleBadge";
import { formatPaise } from "@/lib/currency";
import { itemStock, searchCatalog } from "@/lib/search";
import { findSubstitutes } from "@/lib/substitutes";
import type { Item } from "@/lib/types";
import { useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;

export function ItemSearch() {
  const addItem = useBill((s) => s.addItem);
  const catalog = useCatalog((s) => s.items);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => searchCatalog(query, catalog).slice(0, MAX_RESULTS),
    [query, catalog],
  );

  useEffect(() => inputRef.current?.focus(), []);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function add(item: Item) {
    if (itemStock(item) <= 0) return;
    addItem(item);
    setQuery("");
    setHighlight(0);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) {
        (document.querySelector("[data-bill-row]") as HTMLElement | null)?.focus();
        return;
      }
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[highlight];
      if (!item) return;
      // In stock → add it; out of stock → add the best (top-ranked) substitute.
      add(itemStock(item) > 0 ? item : (findSubstitutes(item, catalog)[0]?.item ?? item));
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search by name, salt, manufacturer, HSN or barcode…"
        aria-label="Item search"
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base placeholder:text-muted-foreground focus-visible:border-ring"
      />

      {results.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border bg-popover shadow-md"
        >
          {results.map((item, i) => {
            const stock = itemStock(item);
            const inStock = stock > 0;
            const subs = inStock ? [] : findSubstitutes(item, catalog);
            const topSub = subs[0];
            const price = item.batches[0]?.mrpPaise ?? topSub?.mrpPaise ?? 0;
            return (
              <li
                key={item.id}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => (inStock ? add(item) : topSub && add(topSub.item))}
                className={cn(
                  "flex cursor-pointer items-start gap-3 border-l-2 border-transparent px-3 py-2 text-sm",
                  i === highlight && "border-l-primary bg-primary/10",
                  !inStock && !topSub && "opacity-70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", !inStock && "text-text-tertiary line-through")}>
                      {item.name}
                    </span>
                    <ScheduleBadge schedule={item.schedule} />
                    {inStock && item.batches.length > 1 && (
                      <span className="text-xs text-muted-foreground">{item.batches.length} batches</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.salt} · {item.manufacturer} · {item.pack}
                  </div>
                  {!inStock && subs.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      <span className="text-xs text-text-tertiary">In-stock substitutes (same salt):</span>
                      {subs.map((s, si) => (
                        <button
                          key={s.item.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            add(s.item);
                          }}
                          className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2 py-1 text-left hover:border-primary hover:bg-primary/5"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-medium">{s.item.name}</span>
                            {si === 0 && (
                              <span className="rounded bg-success-bg px-1 text-[10px] font-medium text-success">
                                Best
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {s.stock} in stock · {formatPaise(s.mrpPaise)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!inStock && subs.length === 0 && (
                    <div className="text-xs text-destructive">Out of stock: no same-salt substitute available</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("font-medium", !inStock && "text-text-tertiary")}>{formatPaise(price)}</div>
                  <div className={cn("text-xs", inStock ? "text-muted-foreground" : "text-destructive")}>
                    {inStock ? `${stock} in stock` : "Out of stock"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
