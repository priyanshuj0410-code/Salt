import type { Item } from "./types";
import { brandKey } from "./brandKey";

/** A row from the global `master_items` reference (the seeded national drug master). */
export interface MasterRow {
  id: string;
  name: string;
  salt: string | null;
  hsn: string | null;
  gst_rate: number | string | null;
  schedule: string | null;
}

/** A row from `brand_aliases` — the de-identified brand -> composition/category crosswalk. */
export interface BrandAliasRow {
  brand_key: string;
  brand: string;
  manufacturer: string | null;
  composition: string | null;
  category: string | null;
  confidence: string | null;
}

export interface EnrichPatch {
  /** Set only when an item matched the molecule master; brand-only fills omit it. */
  master_item_id?: string;
  salt?: string;
  hsn?: string;
  gst_rate?: number;
  therapeutic_category?: string;
}

export interface EnrichPlanRow {
  itemId: string;
  itemName: string;
  masterName: string;
  patch: EnrichPatch;
  /** Human labels of the fields that will be filled, e.g. ["salt","HSN","GST"]. */
  fills: string[];
  /** Where the salt came from: the molecule master, or the brand crosswalk. */
  source?: "master" | "brand";
  /** `brand_aliases` confidence when source === "brand" (high-verified | high | med). */
  confidence?: string;
  /** When the new salt replaced a placeholder (e.g. "OTHERS"), the value it overwrote —
   *  surfaced so the (reviewed) overwrite is transparent. */
  replacedSalt?: string;
}

/**
 * Aggressive match key: lowercase, drop everything non-alphanumeric (so "650mg",
 * "650 mg" and "650-mg" all collapse). Bridges minor spelling/spacing variation
 * between a shop's item and a generic master entry while staying high-precision.
 */
function key(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Marg / legacy catalogues stamp un-classified items with a junk salt placeholder
 * ("OTHERS", "NA", "-") rather than leaving it blank. Treat those as blank so they
 * become eligible for enrichment — but never a real molecule. Matched case-insensitively
 * after trimming. (No real molecule name collides with these.)
 */
const SALT_PLACEHOLDERS = new Set([
  "others", "other", "na", "n/a", "nil", "none", "general", "misc",
  "miscellaneous", "unknown", "-", "--", "---", ".", "0", "x", "xxx",
]);
export function isBlankish(s: string | null | undefined): boolean {
  const t = (s ?? "").trim();
  return t === "" || SALT_PLACEHOLDERS.has(t.toLowerCase());
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
  // Prefer matching on the item's salt (molecule), then its name. A placeholder
  // salt ("OTHERS") is not a molecule, so don't match on it — fall through to the name.
  const saltKey = isBlankish(item.salt) ? "" : key(item.salt);
  return (saltKey ? idx.get(saltKey) : undefined) ?? idx.get(key(item.name));
}

const CONF_RANK: Record<string, number> = { "high-verified": 0, high: 1, med: 2, low: 3 };

/** Index brand_aliases by brand_key (several rows per key = different strengths/forms). */
export function buildBrandIndex(rows: BrandAliasRow[]): Map<string, BrandAliasRow[]> {
  const idx = new Map<string, BrandAliasRow[]>();
  for (const r of rows) {
    const k = r.brand_key || brandKey(r.brand);
    if (!k) continue;
    const list = idx.get(k);
    if (list) list.push(r);
    else idx.set(k, [r]);
  }
  return idx;
}

/**
 * Resolve an item to a single brand_aliases row by its (cleaned) name, disambiguated
 * by manufacturer. Returns undefined when there is no usable row or the key is
 * genuinely ambiguous (one cleaned name -> several different molecules) — we never
 * guess a molecule. Skips the `low` bucket (those carry no composition).
 */
function matchBrand(item: Item, idx: Map<string, BrandAliasRow[]>): BrandAliasRow | undefined {
  const found = idx.get(brandKey(item.name));
  if (!found?.length) return undefined;
  let cands = found.filter((c) => c.composition?.trim() && c.confidence !== "low");
  if (!cands.length) return undefined;
  // Disambiguate shared brand stems by manufacturer when the item names one.
  const mk = key(item.manufacturer);
  if (cands.length > 1 && mk) {
    const byMfr = cands.filter((c) => key(c.manufacturer) === mk);
    if (byMfr.length) cands = byMfr;
  }
  // Still pointing at more than one distinct molecule -> ambiguous, bail.
  if (new Set(cands.map((c) => key(c.composition))).size > 1) return undefined;
  return [...cands].sort((a, b) => (CONF_RANK[a.confidence ?? ""] ?? 9) - (CONF_RANK[b.confidence ?? ""] ?? 9))[0];
}

/**
 * Plan which catalogue items can be enriched. For each item, fill ONLY missing fields
 * (blank salt, blank HSN, zero GST) — never overwrites a value the shop already has.
 * The molecule master supplies salt/HSN/GST + the master link; when it can't resolve
 * the salt (the item is a brand, not a generic), the brand crosswalk fills salt (and
 * therapeutic category) from `brand_aliases`. Items with a match but nothing missing
 * are skipped.
 */
export function planEnrichment(
  items: Item[],
  master: MasterRow[],
  brandAliases: BrandAliasRow[] = [],
): EnrichPlanRow[] {
  const idx = buildMasterIndex(master);
  const bidx = buildBrandIndex(brandAliases);
  const plan: EnrichPlanRow[] = [];
  for (const it of items) {
    const patch: EnrichPatch = {};
    const fills: string[] = [];
    let masterName = "";
    let source: "master" | "brand" | undefined;
    let confidence: string | undefined;
    const origSalt = (it.salt ?? "").trim();
    const saltOpen = isBlankish(it.salt); // blank OR a placeholder ("OTHERS") -> fillable

    const m = matchMaster(it, idx);
    if (m) {
      patch.master_item_id = m.id;
      masterName = m.name;
      source = "master";
      if (saltOpen && m.salt?.trim()) {
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
    }

    // Brand crosswalk: fill the molecule (and category) when the master could not.
    if (!patch.salt && saltOpen && bidx.size) {
      const ba = matchBrand(it, bidx);
      if (ba) {
        patch.salt = ba.composition!.trim();
        fills.push("salt");
        source = "brand";
        confidence = ba.confidence ?? undefined;
        if (!masterName) masterName = ba.brand;
        if (ba.category?.trim() && isBlankish(it.therapeuticCategory)) {
          patch.therapeutic_category = ba.category.trim();
          fills.push("category");
        }
      }
    }

    if (fills.length === 0) continue; // matched but nothing missing to fill
    const replacedSalt = patch.salt && origSalt !== "" ? origSalt : undefined;
    plan.push({ itemId: it.id, itemName: it.name, masterName, patch, fills, source, confidence, replacedSalt });
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
