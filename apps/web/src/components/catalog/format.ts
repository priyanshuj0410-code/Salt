import type { Item } from "@/lib/types";
import { formatPaise } from "@/lib/currency";

/** Printed MRP for an item: one value, a range when batches disagree, or "—". */
export function mrpRange(item: Item): string {
  const mrps = [...new Set(item.batches.map((b) => b.mrpPaise))].sort((a, b) => a - b);
  if (mrps.length === 0) return "—";
  if (mrps.length === 1) return formatPaise(mrps[0]);
  return `${formatPaise(mrps[0])} – ${formatPaise(mrps[mrps.length - 1])}`;
}
