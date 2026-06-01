import { create } from "zustand";
import type { Batch, BillLine, DiscountType, Item, Payment, PaymentMethod } from "@/lib/types";
import type { OrderParty, RxDetails } from "@/lib/orders";
import { splitInclusiveGst } from "@/lib/currency";
import {
  apportionedLineNets,
  billDiscountPaise,
  lineCost,
  lineDiscount,
  lineGross,
  NO_BILL_DISCOUNT,
  sumItemQty,
  type BillDiscount,
} from "@/lib/billing";
import { fefoBatch, itemStock } from "@/lib/search";

export interface BillTotals {
  items: number;
  qty: number;
  gross: number;
  /** Total per-line discount, in paise. */
  discount: number;
  /** Bill-level discount applied on top of line discounts, in paise. */
  billDiscount: number;
  taxable: number;
  gst: number;
  grand: number;
  cost: number;
  margin: number;
}

const lineKey = (itemId: string, batchNo: string) => `${itemId}:${batchNo}`;

function makeLine(item: Item, batch: Batch): BillLine {
  return {
    key: lineKey(item.id, batch.batchNo),
    itemId: item.id,
    name: item.name,
    salt: item.salt,
    pack: item.pack,
    hsn: item.hsn,
    schedule: item.schedule,
    gstRate: item.gstRate,
    batchNo: batch.batchNo,
    expiry: batch.expiry,
    mrpPaise: batch.mrpPaise,
    ptrPaise: batch.ptrPaise,
    // Billed rate starts at MRP; the price-resolution effect (SALT-191A) lowers it if a
    // customer pricing rule applies. `pricedForParty: null` flags it as not-yet-resolved.
    ratePaise: batch.mrpPaise,
    ruleLabel: "MRP",
    priceOverridden: false,
    pricedForParty: null,
    stock: itemStock(item),
    qty: 1,
    discountType: "pct",
    discountValue: 0,
  };
}

interface BillState {
  lines: BillLine[];
  payment: Payment;
  /** The customer this bill is for; null = walk-in. */
  party: OrderParty | null;
  setParty: (party: OrderParty | null) => void;
  /** Captured prescription for a Schedule H1/X sale; null until the gate is filled. */
  rx: RxDetails | null;
  setRx: (rx: RxDetails | null) => void;
  /** Whole-bill discount, on top of per-line discounts (SALT-014). */
  billDiscount: BillDiscount;
  setBillDiscount: (d: BillDiscount) => void;
  /** Replace the whole current bill at once — used when resuming a held bill (SALT-191B). */
  loadBill: (b: {
    lines: BillLine[];
    payment: Payment;
    party: OrderParty | null;
    rx: RxDetails | null;
    billDiscount: BillDiscount;
  }) => void;
  /** Add an item; defaults to its FEFO batch. Re-adding the same batch increments qty. */
  addItem: (item: Item, batchNo?: string) => void;
  setQty: (key: string, qty: number) => void;
  setDiscount: (key: string, type: DiscountType, value: number) => void;
  /** Apply a resolved price (SALT-191A): set the billed rate + the "why" label, unless the
   *  line was manually overridden. `partyKey` records who it was priced for so the resolver
   *  re-runs when the customer changes. */
  applyResolvedPrice: (key: string, pricePaise: number, ruleLabel: string, partyKey: string) => void;
  /** Manually set a line's billed rate — a sticky override that resolution won't overwrite. */
  setRate: (key: string, pricePaise: number) => void;
  /** Move a line to a different batch of the same item (re-keys, merges if needed). */
  setBatch: (key: string, item: Item, batch: Batch) => void;
  removeLine: (key: string) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setCreditDays: (days: number) => void;
  clear: () => void;
}

export const useBill = create<BillState>((set) => ({
  lines: [],
  payment: { method: "cash", creditDays: 30 },
  party: null,
  rx: null,
  billDiscount: NO_BILL_DISCOUNT,

  setParty: (party) => set({ party }),
  setRx: (rx) => set({ rx }),
  setBillDiscount: (billDiscount) => set({ billDiscount }),
  loadBill: (b) => set({ ...b }),

  addItem: (item, batchNo) =>
    set((state) => {
      const batch = batchNo
        ? item.batches.find((b) => b.batchNo === batchNo)
        : fefoBatch(item);
      if (!batch) return state;
      const key = lineKey(item.id, batch.batchNo);
      const existing = state.lines.find((l) => l.key === key);
      if (existing) {
        const cap = existing.stock - sumItemQty(state.lines, item.id, [existing.key]);
        return {
          lines: state.lines.map((l) =>
            l.key === key ? { ...l, qty: Math.min(l.qty + 1, cap) } : l,
          ),
        };
      }
      // No availability left across all batches of this item.
      if (itemStock(item) - sumItemQty(state.lines, item.id) < 1) return state;
      return { lines: [...state.lines, makeLine(item, batch)] };
    }),

  setQty: (key, qty) =>
    set((state) => {
      const target = state.lines.find((l) => l.key === key);
      if (!target) return state;
      const cap = target.stock - sumItemQty(state.lines, target.itemId, [key]);
      return {
        lines: state.lines
          .map((l) => (l.key === key ? { ...l, qty: Math.min(Math.floor(qty), cap) } : l))
          .filter((l) => l.qty > 0),
      };
    }),

  setDiscount: (key, type, value) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.key === key
          ? { ...l, discountType: type, discountValue: Math.max(0, value) }
          : l,
      ),
    })),

  applyResolvedPrice: (key, pricePaise, ruleLabel, partyKey) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.key === key && !l.priceOverridden
          ? { ...l, ratePaise: Math.max(0, Math.round(pricePaise)), ruleLabel, pricedForParty: partyKey }
          : l,
      ),
    })),

  setRate: (key, pricePaise) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        l.key === key
          ? { ...l, ratePaise: Math.max(0, Math.round(pricePaise)), priceOverridden: true, ruleLabel: "Manual" }
          : l,
      ),
    })),

  setBatch: (key, item, batch) =>
    set((state) => {
      const line = state.lines.find((l) => l.key === key);
      if (!line || line.batchNo === batch.batchNo) return state;
      const newKey = lineKey(item.id, batch.batchNo);
      const target = state.lines.find((l) => l.key === newKey);
      if (target) {
        // Merge into the existing line for that batch, drop the old one.
        const cap = target.stock - sumItemQty(state.lines, item.id, [newKey, key]);
        return {
          lines: state.lines
            .filter((l) => l.key !== key)
            .map((l) =>
              l.key === newKey ? { ...l, qty: Math.min(l.qty + line.qty, cap) } : l,
            ),
        };
      }
      return {
        lines: state.lines.map((l) =>
          l.key === key
            ? {
                ...l,
                key: newKey,
                batchNo: batch.batchNo,
                expiry: batch.expiry,
                mrpPaise: batch.mrpPaise,
                ptrPaise: batch.ptrPaise,
                // New batch ⇒ new MRP; a non-overridden line re-prices from it (SALT-191A).
                ...(l.priceOverridden
                  ? {}
                  : { ratePaise: batch.mrpPaise, ruleLabel: "MRP", pricedForParty: null }),
              }
            : l,
        ),
      };
    }),

  removeLine: (key) =>
    set((state) => ({ lines: state.lines.filter((l) => l.key !== key) })),

  setPaymentMethod: (method) =>
    set((state) => ({ payment: { ...state.payment, method } })),

  setCreditDays: (days) =>
    set((state) => ({ payment: { ...state.payment, creditDays: Math.max(0, Math.floor(days)) } })),

  clear: () => set({ lines: [], payment: { method: "cash", creditDays: 30 }, party: null, rx: null, billDiscount: NO_BILL_DISCOUNT }),
}));

export function billTotals(lines: BillLine[], bill: BillDiscount = NO_BILL_DISCOUNT): BillTotals {
  // Per-line net AFTER the bill-level discount is apportioned, so taxable / GST /
  // grand are all computed on what the customer actually pays for each line.
  const nets = apportionedLineNets(lines, bill);
  let gross = 0;
  let discount = 0;
  let taxable = 0;
  let gst = 0;
  let grand = 0;
  let cost = 0;
  let qty = 0;
  lines.forEach((l, i) => {
    const net = nets[i];
    const split = splitInclusiveGst(net, l.gstRate);
    gross += lineGross(l);
    discount += lineDiscount(l);
    taxable += split.taxable;
    gst += split.gst;
    grand += net;
    cost += lineCost(l);
    qty += l.qty;
  });
  return {
    items: lines.length,
    qty,
    gross,
    discount,
    billDiscount: billDiscountPaise(lines, bill),
    taxable,
    gst,
    grand,
    cost,
    margin: grand - cost,
  };
}
