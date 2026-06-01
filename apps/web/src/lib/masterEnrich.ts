import type { Item } from "./types";

/** A row from the global `master_items` reference (the seeded national drug master). */
export interface MasterRow {
  id: string;
  name: string;
  salt: string | null;
  hsn: string | null;
  gst_rate: number | string | null;
  schedule: string | null;
}

export interface EnrichPatch {
  master_item_id: string;
  salt?: string;
  hsn?: string;
  gst_rate?: number;
}

export interface EnrichPlanRow {
  itemId: string;
  itemName: string;
  masterName: string;
  patch: EnrichPatch;
  /** Human labels of the fields that will be filled, e.g. ["salt","HSN","GST"]. */
  fills: string[];
}

/**
 * Aggressive match key: lowercase, drop everything non-alphanumeric (so "650mg",
 * "650 mg" and "650-mg" all collapse). Bridges minor spelling/spacing variation
 * between a shop's item and a generic master entry while staying high-precision.
 */
function key(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Index master rows by salt-key then name-key (salt first — it's the molecule-level match). */
export function buildMasterIndex(master: MasterRow[]): Map<string, MasterRow> {
  const idx = new Map<string, MasterRow>();
  for (const m of master) {
    const ks = [key(m.salt), key(m.name)];
    for (const k of ks) if (k && !idx.has(k)) idx.set(k, m);
  }
  return idx;
}

function matchMaster(item: Item, idx: Map<string, MasterRow>): MasterRow | undefined {
  // Prefer matching on the item's salt (molecule), then its name.
  return idx.get(key(item.salt)) ?? idx.get(key(item.name));
}

/**
 * Plan which catalogue items can be enriched from the master. For each item with an
 * exact match, fill ONLY the fields that are currently missing (blank salt, blank HSN,
 * zero GST) and record the master link. Items with a match but nothing missing are
 * skipped — this never overwrites a value the shop already has.
 */
export function planEnrichment(items: Item[], master: MasterRow[]): EnrichPlanRow[] {
  const idx = buildMasterIndex(master);
  const plan: EnrichPlanRow[] = [];
  for (const it of items) {
    const m = matchMaster(it, idx);
    if (!m) continue;
    const patch: EnrichPatch = { master_item_id: m.id };
    const fills: string[] = [];
    if (!it.salt?.trim() && m.salt?.trim()) {
      patch.salt = m.salt.trim();
      fills.push("salt");
    }
    if (!it.hsn?.trim() && m.hsn?.trim()) {
      patch.hsn = m.hsn.trim();
      fills.push("HSN");
    }
    const mRate = Number(m.gst_rate) || 0;
    if ((!it.gstRate || it.gstRate === 0) && mRate > 0) {
      patch.gst_rate = mRate;
      fills.push("GST");
    }
    if (fills.length === 0) continue; // matched but nothing missing to fill
    plan.push({ itemId: it.id, itemName: it.name, masterName: m.name, patch, fills });
  }
  return plan;
}

export interface SaltReplaceRow {
  itemId: string;
  itemName: string;
  /** Current salt on the item ("" when blank). */
  fromSalt: string;
  /** The master's salt that would replace it. */
  toSalt: string;
  masterId: string;
}

/** Index master rows by NAME key only (the trigger for salt review is a name match). */
function nameIndex(master: MasterRow[]): Map<string, MasterRow> {
  const idx = new Map<string, MasterRow>();
  for (const m of master) {
    const k = key(m.name);
    if (k && !idx.has(k)) idx.set(k, m);
  }
  return idx;
}

/**
 * Plan salt corrections: where an item's NAME matches a master entry and the master
 * carries a salt that DIFFERS from the item's (ignoring case/spacing), propose replacing
 * the item's salt with the master's. Unlike planEnrichment (fill-only), this overwrites an
 * existing value, so callers must present it for per-item review/approval. Rows whose salt
 * already equals the master (case/space-insensitive) are skipped.
 */
export function planSaltReplacements(items: Item[], master: MasterRow[]): SaltReplaceRow[] {
  const idx = nameIndex(master);
  const out: SaltReplaceRow[] = [];
  for (const it of items) {
    const m = idx.get(key(it.name));
    if (!m || !m.salt?.trim()) continue;
    const cur = it.salt?.trim() ?? "";
    if (key(cur) === key(m.salt)) continue; // already equivalent
    out.push({ itemId: it.id, itemName: it.name, fromSalt: cur, toSalt: m.salt.trim(), masterId: m.id });
  }
  return out;
}
