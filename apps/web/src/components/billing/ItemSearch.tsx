import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScheduleBadge } from "./ScheduleBadge";
import { catalog } from "@/data/catalog";
import { formatPaise } from "@/lib/currency";
import { itemStock, searchCatalog } from "@/lib/search";
import type { Item } from "@/lib/types";
import { useBill } from "@/store/bill";
import { cn } from "@/lib/utils";

const MAX_RESULTS = 8;

function substituteFor(item: Item): Item | undefined {
  return catalog.find(
    (c) => c.id !== item.id && c.salt === item.salt && itemStock(c) > 0,
  );
}

export function ItemSearch() {
  const addItem = useBill((s) => s.addItem);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchCatalog(query, catalog).slice(0, MAX_RESULTS),
    [query],
  );

  useEffect(() => inputRef.current?.focus(), []);

  function add(item: Item) {
    if (itemStock(item) <= 0) return;
    addItem(item);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[highlight];
      if (item) add(item);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search by name, salt, manufacturer, HSN or barcode…"
        className="h-11 text-base"
        aria-label="Item search"
      />

      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
          {results.map((item, i) => {
            const stock = itemStock(item);
            const inStock = stock > 0;
            const sub = inStock ? undefined : substituteFor(item);
            return (
              <li
                key={item.id}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => (inStock ? add(item) : sub && add(sub))}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
                  i === highlight && "bg-muted",
                  !inStock && "opacity-70",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <ScheduleBadge schedule={item.schedule} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.salt} · {item.manufacturer} · {item.pack}
                  </div>
                  {!inStock && sub && (
                    <div className="text-xs text-primary">
                      Out of stock — substitute: {sub.name} ({sub.salt})
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-medium">{formatPaise(item.batches[0]?.mrpPaise ?? sub?.batches[0]?.mrpPaise ?? 0)}</div>
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
