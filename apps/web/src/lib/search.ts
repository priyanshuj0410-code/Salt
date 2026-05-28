import type { Item } from "./types";

export function itemStock(item: Item): number {
  return item.batches.reduce((sum, b) => sum + b.qty, 0);
}

/** Earliest-expiring batch that still has stock (FEFO), or undefined if out of stock. */
export function fefoBatch(item: Item) {
  return item.batches
    .filter((b) => b.qty > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
}

function fieldScore(field: string | undefined, q: string): number {
  if (!field) return 0;
  const f = field.toLowerCase();
  if (f === q) return 100;
  if (f.startsWith(q)) return 70;
  if (f.includes(q)) return 40;
  // subsequence fallback: "dlo" matches "dolo"
  let i = 0;
  for (const ch of f) if (ch === q[i]) i++;
  return i === q.length ? 15 : 0;
}

/**
 * Rank the catalog for a query. Single input matches name, salt, manufacturer,
 * HSN, or barcode (FR-S-010). Ranking: in-stock first, then match strength,
 * then sales velocity (FR-S-011).
 */
export function searchCatalog(query: string, items: Item[]): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = items
    .map((item) => {
      const score = Math.max(
        fieldScore(item.name, q) * 1.0,
        fieldScore(item.salt, q) * 0.9,
        fieldScore(item.manufacturer, q) * 0.6,
        fieldScore(item.hsn, q) * 0.5,
        fieldScore(item.barcode, q) * 1.0,
      );
      return { item, score, inStock: itemStock(item) > 0 };
    })
    .filter((r) => r.score > 0);

  scored.sort((a, b) => {
    if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return b.item.velocity - a.item.velocity;
  });

  return scored.map((r) => r.item);
}
