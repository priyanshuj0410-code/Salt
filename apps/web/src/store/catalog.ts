import { create } from "zustand";
import type { Item, Schedule } from "@/lib/types";
import { catalog as seedCatalog } from "@/data/catalog";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";
import { cacheKey, cacheGet, cachePut } from "@/lib/offline/cache";

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
  /** Optional: present only once migration 0033 (cold_chain) is applied. */
  cold_chain?: boolean | null;
}

// items column sets: the rich set includes cold_chain (migration 0033); the base
// set omits it so the catalogue still loads if that migration has not run yet.
const ITEM_COLS_BASE = "id,name,salt,manufacturer,pack,hsn,gst_rate,schedule,barcode,ayush_flag,reorder_level";
const ITEM_COLS = `${ITEM_COLS_BASE},cold_chain`;

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
  load: (orgId: string) => Promise<void>;
  /** Add or replace a single item (e.g. one just created at GRN entry) without a
   *  full reload. The first real item also drops the demo seed. */
  upsertItem: (item: Item) => void;
  /** Patch one batch's on-hand qty in place — driven by the live-stock realtime feed (SALT-179)
   *  so another counter's sale/receipt reflects on this counter's search + FEFO without a reload. */
  applyBatchQty: (itemId: string, batchNo: string, qty: number) => void;
}

function mapRows(items: ItemRow[], batches: BatchRow[]): Item[] {
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
    gstRate: Number(r.gst_rate) || 0,
    schedule: r.schedule as Schedule,
    barcode: r.barcode ?? undefined,
    ayush: r.ayush_flag ?? false,
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
      if (items.length === 0) {
        set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true, cachedAt: null });
        return;
      }
      const mapped = mapRows(items, batches);
      set({ items: mapped, usingSeed: false, loading: false, loaded: true, cachedAt: null });
      // Persist the working set so the counter can bill offline (SALT-204 / ADR 0017).
      void cachePut(cacheKey("catalog", orgId), mapped);
    } catch {
      // Load failed (typically offline). Prefer the org's real catalogue from the
      // offline read-cache over the demo seed; only seed if nothing is cached.
      const cached = await cacheGet<Item[]>(cacheKey("catalog", orgId));
      if (cached && cached.data.length > 0) {
        set({ items: cached.data, usingSeed: false, loading: false, loaded: true, cachedAt: cached.cachedAt });
      } else {
        set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true, cachedAt: null });
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
