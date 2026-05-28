import { create } from "zustand";
import type { BillLine, Item } from "@/lib/types";
import { splitInclusiveGst } from "@/lib/currency";
import { fefoBatch } from "@/lib/search";

export interface BillTotals {
  items: number;
  qty: number;
  taxable: number;
  gst: number;
  grand: number;
}

interface BillState {
  lines: BillLine[];
  /** Add an item at its FEFO batch; re-adding the same batch increments qty. */
  addItem: (item: Item) => void;
  setQty: (key: string, qty: number) => void;
  removeLine: (key: string) => void;
  clear: () => void;
}

export const useBill = create<BillState>((set) => ({
  lines: [],

  addItem: (item) =>
    set((state) => {
      const batch = fefoBatch(item);
      if (!batch) return state;
      const key = `${item.id}:${batch.batchNo}`;
      const existing = state.lines.find((l) => l.key === key);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.key === key ? { ...l, qty: l.qty + 1 } : l,
          ),
        };
      }
      const line: BillLine = {
        key,
        itemId: item.id,
        name: item.name,
        salt: item.salt,
        pack: item.pack,
        schedule: item.schedule,
        gstRate: item.gstRate,
        batchNo: batch.batchNo,
        expiry: batch.expiry,
        mrpPaise: batch.mrpPaise,
        qty: 1,
      };
      return { lines: [...state.lines, line] };
    }),

  setQty: (key, qty) =>
    set((state) => ({
      lines: state.lines
        .map((l) => (l.key === key ? { ...l, qty } : l))
        .filter((l) => l.qty > 0),
    })),

  removeLine: (key) =>
    set((state) => ({ lines: state.lines.filter((l) => l.key !== key) })),

  clear: () => set({ lines: [] }),
}));

export function billTotals(lines: BillLine[]): BillTotals {
  let taxable = 0;
  let gst = 0;
  let grand = 0;
  let qty = 0;
  for (const l of lines) {
    const gross = l.mrpPaise * l.qty;
    const split = splitInclusiveGst(gross, l.gstRate);
    taxable += split.taxable;
    gst += split.gst;
    grand += gross;
    qty += l.qty;
  }
  return { items: lines.length, qty, taxable, gst, grand };
}
