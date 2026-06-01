import { create } from "zustand";
import type { BillLine, Payment } from "@/lib/types";
import type { OrderParty, RxDetails } from "@/lib/orders";
import { NO_BILL_DISCOUNT, type BillDiscount } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
import { useBill } from "./bill";

/**
 * Server-backed held bills (SALT-191B, replacing the in-memory SALT-008 store) — a bill set
 * aside on one counter can be resumed on any counter/device. Backed by the `held_bills` table +
 * `hold_bill` / `resume_bill` (atomic claim) / `discard_held_bill` RPCs (migration 0040), kept in
 * sync across counters by a realtime subscription wired in `BillingScreen`.
 *
 * The row's `lines`/`payment`/`rx` are free-form jsonb; we fold `party` (with its name) and
 * `billDiscount` into `payment` so a resume restores the full bill (the row's `party_id` column
 * carries only the id).
 */
export interface HeldBill {
  id: string;
  label: string;
  heldAt: string;
  lines: BillLine[];
  payment: Payment;
  party: OrderParty | null;
  rx: RxDetails | null;
  billDiscount: BillDiscount;
}

interface HeldRow {
  id: string;
  label: string | null;
  held_at: string;
  lines: BillLine[] | null;
  payment: { method?: Payment["method"]; creditDays?: number; billDiscount?: BillDiscount; party?: OrderParty | null } | null;
  rx: RxDetails | null;
}

function fromRow(r: HeldRow): HeldBill {
  return {
    id: r.id,
    label: r.label ?? "Walk-in",
    heldAt: r.held_at,
    lines: r.lines ?? [],
    payment: { method: r.payment?.method ?? "cash", creditDays: r.payment?.creditDays ?? 30 },
    party: r.payment?.party ?? null,
    rx: r.rx ?? null,
    billDiscount: r.payment?.billDiscount ?? NO_BILL_DISCOUNT,
  };
}

const SELECT = "id,label,held_at,lines,payment,rx";

interface HeldBillsState {
  held: HeldBill[];
  /** Load this shop's held bills (call on mount; realtime re-calls it on any change). */
  load: (shopId: string) => Promise<void>;
  /** Hold the current bill to the server and clear the counter. No-op on an empty bill. */
  hold: (shopId: string) => Promise<void>;
  /** Resume a held bill onto the counter; the in-progress bill (if any) is held in its place. */
  resume: (shopId: string, id: string) => Promise<void>;
  /** Drop a held bill without resuming it. */
  discard: (id: string) => Promise<void>;
}

export const useHeldBills = create<HeldBillsState>((set, get) => ({
  held: [],

  load: async (shopId) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("held_bills")
      .select(SELECT)
      .eq("shop_id", shopId)
      .order("held_at", { ascending: false });
    set({ held: ((data as HeldRow[] | null) ?? []).map(fromRow) });
  },

  hold: async (shopId) => {
    if (!supabase) return;
    const b = useBill.getState();
    if (b.lines.length === 0) return;
    const { error } = await supabase.rpc("hold_bill", {
      p_shop_id: shopId,
      p_party_id: b.party?.id ?? null,
      p_lines: b.lines,
      p_payment: { method: b.payment.method, creditDays: b.payment.creditDays, billDiscount: b.billDiscount, party: b.party },
      p_rx: b.rx,
      p_label: b.party?.name ?? "Walk-in",
    });
    if (error) return; // best-effort — leave the bill on the counter if the hold failed
    b.clear();
    await get().load(shopId);
  },

  resume: async (shopId, id) => {
    if (!supabase) return;
    // Hold the in-progress bill first so it is never lost (swap semantics, SALT-008).
    if (useBill.getState().lines.length > 0) await get().hold(shopId);
    const { data, error } = await supabase.rpc("resume_bill", { p_id: id });
    if (error || !data) return; // already resumed on another counter, etc.
    const row = fromRow(data as HeldRow);
    useBill.getState().loadBill({
      lines: row.lines,
      payment: row.payment,
      party: row.party,
      rx: row.rx,
      billDiscount: row.billDiscount,
    });
    await get().load(shopId);
  },

  discard: async (id) => {
    if (!supabase) return;
    await supabase.rpc("discard_held_bill", { p_id: id });
    set({ held: get().held.filter((h) => h.id !== id) }); // optimistic; realtime confirms
  },
}));
