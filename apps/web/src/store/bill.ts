import { create } from "zustand";
import type { Batch, BillLine, DiscountType, Item, Payment, PaymentMethod } from "@/lib/types";
import type { OrderParty, RxDetails } from "@/lib/orders";
import { splitInclusiveGst } from "@/lib/currency";
import { lineCost, lineDiscount, lineGross, lineNet, sumItemQty } from "@/lib/billing";
import { fefoBatch, itemStock } from "@/lib/search";

export interface BillTotals {
  items: number;
  qty: number;
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  grand: number;
  cost: number;
  margin: number;
}

/** A bill set aside on this counter to be resumed later (SALT-008, local/in-memory). */
export interface ParkedBill {
  id: string;
  /** Display label — the customer name, or "Walk-in". */
  label: string;
  parkedAt: number;
  lines: BillLine[];
  payment: Payment;
  party: OrderParty | null;
  rx: RxDetails | null;
}

/** Snapshot the bill-defining fields of the current state into a parked bill. */
function makeParked(s: Pick<BillState, "lines" | "payment" | "party" | "rx">): ParkedBill {
  return {
    id: crypto.randomUUID(),
    label: s.party?.name ?? "Walk-in",
    parkedAt: Date.now(),
    lines: s.lines,
    payment: s.payment,
    party: s.party,
    rx: s.rx,
  };
}

const freshFields = () => ({
  lines: [] as BillLine[],
  payment: { method: "cash" as PaymentMethod, creditDays: 30 },
  party: null as OrderParty | null,
  rx: null as RxDetails | null,
});

const lineKey = (itemId: string, batchNo: string) => `${itemId}:${batchNo}`;

function makeLine(item: Item, batch: Batch): BillLine {
  return {
    key: lineKey(item.id, batch.batchNo),
    itemId: item.id,
    name: item.name,
    salt: item.salt,
    pack: item.pack,
    schedule: item.schedule,
    gstRate: item.gstRate,
    batchNo: batch.batchNo,
    expiry: batch.expiry,
    mrpPaise: batch.mrpPaise,
    ptrPaise: batch.ptrPaise,
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
  /** Bills held aside on this counter, newest first (SALT-008). */
  parked: ParkedBill[];
  /** Hold the current bill aside and start a fresh one. No-op on an empty bill. */
  parkBill: () => void;
  /** Resume a held bill onto the counter; any current bill is held in its place. */
  resumeBill: (id: string) => void;
  /** Drop a held bill without resuming it. */
  discardPark: (id: string) => void;
  /** Add an item; defaults to its FEFO batch. Re-adding the same batch increments qty. */
  addItem: (item: Item, batchNo?: string) => void;
  setQty: (key: string, qty: number) => void;
  setDiscount: (key: string, type: DiscountType, value: number) => void;
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
  parked: [],

  setParty: (party) => set({ party }),
  setRx: (rx) => set({ rx }),

  parkBill: () =>
    set((state) => {
      if (state.lines.length === 0) return state;
      return { parked: [makeParked(state), ...state.parked], ...freshFields() };
    }),

  resumeBill: (id) =>
    set((state) => {
      const target = state.parked.find((p) => p.id === id);
      if (!target) return state;
      const rest = state.parked.filter((p) => p.id !== id);
      // Hold the in-progress bill (if any) in the resumed one's place — never lose a bill.
      const parked = state.lines.length > 0 ? [makeParked(state), ...rest] : rest;
      return { lines: target.lines, payment: target.payment, party: target.party, rx: target.rx, parked };
    }),

  discardPark: (id) => set((state) => ({ parked: state.parked.filter((p) => p.id !== id) })),

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

  clear: () => set({ lines: [], payment: { method: "cash", creditDays: 30 }, party: null, rx: null }),
}));

export function billTotals(lines: BillLine[]): BillTotals {
  let gross = 0;
  let discount = 0;
  let taxable = 0;
  let gst = 0;
  let grand = 0;
  let cost = 0;
  let qty = 0;
  for (const l of lines) {
    const net = lineNet(l);
    const split = splitInclusiveGst(net, l.gstRate);
    gross += lineGross(l);
    discount += lineDiscount(l);
    taxable += split.taxable;
    gst += split.gst;
    grand += net;
    cost += lineCost(l);
    qty += l.qty;
  }
  return { items: lines.length, qty, gross, discount, taxable, gst, grand, cost, margin: grand - cost };
}
