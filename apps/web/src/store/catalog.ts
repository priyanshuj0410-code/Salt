import { create } from "zustand";
import type { Item, Schedule } from "@/lib/types";
import { catalog as seedCatalog } from "@/data/catalog";
import { supabase } from "@/lib/supabase";
import { selectAll } from "@/lib/selectAll";

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
}

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
  load: (orgId: string) => Promise<void>;
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
    velocity: 0,
    batches: byItem.get(r.id) ?? [],
  }));
}

export const useCatalog = create<CatalogState>((set) => ({
  items: seedCatalog,
  loading: false,
  loaded: false,
  usingSeed: true,

  load: async (orgId) => {
    if (!supabase) return;
    set({ loading: true });
    try {
      // Page past PostgREST's 1000-row cap so large catalogues load in full.
      const [items, batches] = await Promise.all([
        selectAll<ItemRow>((from, to) =>
          supabase!
            .from("items")
            .select("id,name,salt,manufacturer,pack,hsn,gst_rate,schedule,barcode")
            .eq("org_id", orgId)
            .range(from, to),
        ),
        selectAll<BatchRow>((from, to) =>
          supabase!
            .from("batches")
            .select("item_id,batch_no,expiry,qty,mrp_paise,ptr_paise")
            .eq("org_id", orgId)
            .range(from, to),
        ),
      ]);
      if (items.length === 0) {
        set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true });
        return;
      }
      set({ items: mapRows(items, batches), usingSeed: false, loading: false, loaded: true });
    } catch {
      // On a load failure, keep the seed and mark loaded so the UI isn't stuck.
      set({ items: seedCatalog, usingSeed: true, loading: false, loaded: true });
    }
  },
}));
