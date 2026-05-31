import type { Item } from "./types";
import { itemStock, fefoBatch } from "./search";

export interface Substitute {
  item: Item;
  /** Total stock across batches. */
  stock: number;
  /** Representative MRP (the FEFO batch) in paise. */
  mrpPaise: number;
  /** Representative PTR (the FEFO batch) in paise. */
  ptrPaise: number;
  /** Margin = MRP − PTR per pack, in paise. */
  marginPaise: number;
  /** Margin as a percentage of MRP (0 when MRP is unknown). */
  marginPct: number;
}

/**
 * Same-salt, in-stock alternatives to `item`, ranked best-first — the engine that
 * answers the trade's "iska salt kya hai?" when a brand is out of stock or the
 * shop wants to push a higher-earning equivalent (SALT-083).
 *
 * Substitution pivots on the salt/molecule, matched exactly (case-insensitive) so
 * different strengths (Paracetamol 500 vs 650) are never offered as equivalents.
 * Ranking: margin % desc (push what earns most), then sales velocity desc (what
 * moves), then more stock. The item itself and out-of-stock items are excluded.
 */
export function findSubstitutes(item: Item, items: Item[]): Substitute[] {
  const salt = item.salt.trim().toLowerCase();
  if (!salt) return [];

  const subs = items
    .filter((c) => c.id !== item.id && c.salt.trim().toLowerCase() === salt && itemStock(c) > 0)
    .map((c) => {
      const batch = fefoBatch(c);
      const mrpPaise = batch?.mrpPaise ?? 0;
      const ptrPaise = batch?.ptrPaise ?? 0;
      const marginPaise = mrpPaise - ptrPaise;
      return {
        item: c,
        stock: itemStock(c),
        mrpPaise,
        ptrPaise,
        marginPaise,
        marginPct: mrpPaise > 0 ? (marginPaise / mrpPaise) * 100 : 0,
      };
    });

  subs.sort(
    (a, b) => b.marginPct - a.marginPct || b.item.velocity - a.item.velocity || b.stock - a.stock,
  );
  return subs;
}
