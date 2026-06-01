import { create } from "zustand";
import type { Item, Schedule } from "@/lib/types";
import { catalog as seedCatalog } from "@/data/catalog";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { cacheKey, cacheGet, cachePut } from "@/lib/offline/cache";
import { gstRateForClass, todayIso, type GstScheduleRow } from "@/lib/gstSchedule";

interface ItemRow {
  id: string;
  name: string;
  salt: string | null;
  manufacturer: string | null;
  pack: string | null;
  hsn: string | null;
  gst_rate: number | string;
  schedule: string;
  barcode: string | null;
  ayush_flag: boolean | null;
  reorder_level: number | null;
  therapeutic_category: string | null;
  /** Optional: present only once migration 0033 (cold_chain) is applied. */
  cold_chain?: boolean | null;
  /** Embedded from the linked master item via master_item_id (SALT-211) — the date-effective GST
   *  rate class. Absent (old DB / unlinked / master_items unreadable) ⇒ fall back to flat gst_rate. */
  master_items?: { gst_rate_class: string | null } | null;
}

// items column sets: the rich set includes cold_chain (migration 0033) + the master GST-rate-class
// embed (SALT-211); the base set omits both so the catalogue still loads if those are unavailable.
const ITEM_COLS_BASE =
  "id,name,salt,manufacturer,pack,hsn,gst_rate,schedule,barcode,ayush_flag,reorder_level,therapeutic_category";
const ITEM_COLS = `${ITEM_COLS_BASE},cold_chain,master_items(gst_rate_class)`;

interface BatchRow {
  item_id: string;
  batch_no: string | null;
  expiry: string | null;
  qty: number;
  mrp_paise: number;
  ptr_paise: number;
}

interface CatalogState {
  /** The org's items (or the demo seed when the org has none). */
  items: Item[];
  loading: boolean;
  loaded: boolean;
  /** True when falling back to the demo seed because the org has no items yet. */
  usingSeed: boolean;
  /** When serving the offline read-cache, the epoch-ms it was written; null when live (SALT-204). */
  cachedAt: number | null;
  /** Date-effective GST rate schedule (migration 0046), loaded once with the catalogue.
   *  Exposed so date-sensitive screens (GRN entry) can resolve a line's rate by the
   *  vendor invoice date via `gstRateForClass(item.gstRateClass, date, gstSchedule)`
   *  without re-querying. Empty when unavailable (offline / seed / migration unapplied)
   *  ⇒ callers fall back to the item's flat `gstRate`. */
  gstSchedule: GstScheduleRow[];
  load: (orgId: string) => Promise<void>;
  /** Add or replace a single item (e.g. one just created at GRN entry) without a
   *  full reload. The first real item also drops the demo seed. */
  upsertItem: (item: Item) => void;
  /** Patch one batch's on-hand qty in place — driven by the live-stock realtime feed (SALT-179)
   *  so another counter's sale/receipt reflects on this counter's search + FEFO without a reload. */
  applyBatchQty: (itemId: string, batchNo: string, qty: number) => void;
}

function mapRows(items: ItemRow[], batches: BatchRow[], schedule: GstScheduleRow[]): Item[] {
  // Resolve each line's GST rate by today's invoice date from the schedule (SALT-211), via the
  // linked master item's rate class; fall back to the item's flat gst_rate when unresolved.
  const today = todayIso();
  const byItem = new Map<string, Item["batches"]>();
  for (const b of batches) {
    const list = byItem.get(b.item_id) ?? [];
    list.push({
      batchNo: b.batch_no ?? "",
      expiry: b.expiry ?? "",
      qty: b.qty,
      mrpPaise: b.mrp_paise,
      ptrPaise: b.ptr_paise,
    });
    byItem.set(b.item_id, list);
  }
  return items.map((r) => ({
    id: r.id,
    name: r.name,
    salt: r.salt ?? "",
    manufacturer: r.manufacturer ?? "",
    pack: r.pack ?? "",
    hsn: r.hsn ?? "",
    gstRate: gstRateForClass(r.master_items?.gst_rate_class, today, schedule) ?? (Number(r.gst_rate) || 0),
    // Carry the master rate class so date-sensitive screens (GRN) can re-resolve the
    // rate by a document date other than today, using the store's `gstSchedule`.
    gstRateClass: r.master_items?.gst_rate_class ?? undefined,
    schedule: r.schedule as Schedule,
    barcode: r.barcode ?? undefined,
    ayush: r.ayush_flag ?? false,
    therapeuticCategory: r.therapeutic_category ?? undefined,
    reorderLevel: r.reorder_level ?? 0,
    coldChain: r.cold_chain ?? false,
    velocity: 0,
    batches: byItem.get(r.id) ?? [],
  }));
}

export const useCatalog = create<CatalogState>((set) => ({
  items: seedCatalog,
  loading: false,
  loaded: false,
  usingSeed: true,
  cachedAt: null,
  gstSchedule: [],

  load: async (orgId) => {
    if (!supabase) return;
    set({ loading: true });
    try {
      // Page past PostgREST's 1000-row cap so large catalogues load in full.
      const batchesPromise = selectAll<BatchRow>((from, to) =>
        supabase!
          .from("batches")
          .select("item_id,batch_no,expiry,qty,mrp_paise,ptr_paise")
          .eq("org_id", orgId)
          .range(from, to),
      );
      // Date-effective GST schedule (SALT-211) — small, org-agnostic, auth-readable; [] on error
      // so the rate resolution simply falls back to each item's flat gst_rate.
      const schedulePromise = supabase!
        .from("gst_rate_schedule")
        .select("rate_class,rate,effective_from,effective_to");
      const loadItems = (cols: string) =>
        selectAll<ItemRow>((from, to) =>
          // A dynamic column string defeats PostgREST type inference, so assert the row shape.
          supabase!.from("items").select(cols).eq("org_id", orgId).range(from, to).returns<ItemRow[]>(),
        );
      // Try the rich column set; if cold_chain (migration 0033) is not applied
      // yet the query errors — fall back to the base set so real data still loads
      // (never silently drop to the demo seed for a connected org).
      let items: ItemRow[];
      try {
        items = await loadItems(ITEM_COLS);
      } catch {
        items = await loadItems(ITEM_COLS_BASE);
      }
      const batches = await batchesPromise;
      const schedule = ((await schedulePromise).data as GstScheduleRow[] | null) ?? [];
      if (items.length === 0) {
        set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true, cachedAt: null, gstSchedule: [] });
        return;
      }
      const mapped = mapRows(items, batches, schedule);
      set({ items: mapped, usingSeed: false, loading: false, loaded: true, cachedAt: null, gstSchedule: schedule });
      // Persist the working set so the counter can bill offline (SALT-204 / ADR 0017).
      void cachePut(cacheKey("catalog", orgId), mapped);
    } catch {
      // Load failed (typically offline). Prefer the org's real catalogue from the
      // offline read-cache over the demo seed; only seed if nothing is cached.
      const cached = await cacheGet<Item[]>(cacheKey("catalog", orgId));
      if (cached && cached.data.length > 0) {
        set({ items: cached.data, usingSeed: false, loading: false, loaded: true, cachedAt: cached.cachedAt, gstSchedule: [] });
      } else {
        set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true, cachedAt: null, gstSchedule: [] });
      }
    }
  },

  upsertItem: (item) =>
    set((s) => {
      // A real item means the org has its own catalogue now — never merge into
      // the demo seed (it would pollute search with fake stock).
      const base = s.usingSeed ? [] : s.items;
      const idx = base.findIndex((i) => i.id === item.id);
      const items = idx >= 0 ? base.map((i, k) => (k === idx ? item : i)) : [...base, item];
      return { items, usingSeed: false, loaded: true };
    }),

  applyBatchQty: (itemId, batchNo, qty) =>
    set((s) => {
      if (s.usingSeed) return s; // the demo seed has no real batches to sync
      return {
        items: s.items.map((it) =>
          it.id === itemId
            ? {
                ...it,
                batches: it.batches.map((b) =>
                  b.batchNo === batchNo ? { ...b, qty: Math.max(0, Math.floor(qty)) } : b,
                ),
              }
            : it,
        ),
      };
    }),
}));
