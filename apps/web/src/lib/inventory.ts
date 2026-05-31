/**
 * Inventory data layer — the shared read-side backbone for the stock module.
 *
 * Everything reads the live stock ledger (per CLAUDE.md / proposed 0016): on-hand
 * lives on `batches.qty` (a cached current-on-hand the document RPCs keep in step),
 * and movement history lives on `stock_movements`. Sales post a `reason='sale'`
 * movement (0018), so velocity / last-sold / dead-stock / turnover all derive from
 * the same two fetches the `useInventory` hook does once.
 *
 * The pure helpers (no React, no Supabase) carry all the arithmetic so they can be
 * smoke-tested in isolation; the views are thin presentation over `useInventory`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const MS_PER_DAY = 86_400_000;

/** How far back we pull sale movements for velocity / last-sold / turnover. */
export const LOOKBACK_DAYS = 180;

// ── Pure: expiry parsing ──────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Last day of the given (year, 0-based month), at end of day — pharma expiry is month-precision. */
function endOfMonth(year: number, month0: number): Date {
  return new Date(year, month0 + 1, 0, 23, 59, 59, 999);
}

/** Expand a 2-digit year the pharma way: 00-79 → 2000s, 80-99 → 1900s. */
function fullYear(yy: number): number {
  if (yy >= 100) return yy;
  return yy < 80 ? 2000 + yy : 1900 + yy;
}

/**
 * Resolve a batch expiry to a real instant. Prefers the parsed `expiry_date`
 * column; falls back to parsing the captured free-text `expiry` (Marg exports
 * "MM/YY", "MM/YYYY", "MMM-YY", "YYYY-MM", …). Month-precision inputs resolve to
 * end-of-month, matching how a strip is actually usable through its expiry month.
 * Returns null when nothing parses.
 */
export function parseExpiry(
  expiryDate: string | null | undefined,
  expiry?: string | null,
): Date | null {
  if (expiryDate) {
    const d = new Date(expiryDate);
    if (!Number.isNaN(d.getTime())) return endOfMonth(d.getUTCFullYear(), d.getUTCMonth());
  }
  const raw = (expiry ?? "").trim();
  if (!raw) return null;

  // YYYY-MM or YYYY/MM
  let m = raw.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m) return endOfMonth(Number(m[1]), Number(m[2]) - 1);

  // MM/YY or MM/YYYY (also MM-YY)
  m = raw.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) {
    const mo = Number(m[1]) - 1;
    if (mo >= 0 && mo <= 11) return endOfMonth(fullYear(Number(m[2])), mo);
  }

  // MMM-YY / MMM YYYY / MMM/YY (e.g. AUG-26, Aug 2026)
  m = raw.match(/^([A-Za-z]{3,})[\s/-]+(\d{2}|\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo != null) return endOfMonth(fullYear(Number(m[2])), mo);
  }
  return null;
}

/** Whole days from `now` until `at` (negative once past). null when `at` is null. */
export function daysUntil(at: Date | null, now: Date = new Date()): number | null {
  if (!at) return null;
  return Math.floor((at.getTime() - now.getTime()) / MS_PER_DAY);
}

// ── Pure: expiry bucketing (mirrors lib/aging band style) ──────────────────

export type ExpiryBucket = "expired" | "d30" | "d60" | "d90" | "fresh";

/** Standard windows surfaced on the near-expiry dashboard. */
export const EXPIRY_BANDS: { key: Exclude<ExpiryBucket, "fresh">; label: string }[] = [
  { key: "expired", label: "Expired" },
  { key: "d30", label: "≤ 30 days" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
];

/** Bucket a days-to-expiry value. null (unparseable expiry) → null. */
export function expiryBucket(days: number | null): ExpiryBucket | null {
  if (days == null) return null;
  if (days < 0) return "expired";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "fresh";
}

// ── Row shapes ─────────────────────────────────────────────────────────────

/** A batch joined to its item, as fetched. Money is integer paise. */
export interface BatchRow {
  batch_id: string;
  item_id: string;
  name: string;
  salt: string | null;
  manufacturer: string | null;
  pack: string | null;
  hsn: string | null;
  gst_rate: number;
  schedule: string;
  reorder_level: number;
  is_active: boolean;
  therapeutic_category: string | null;
  batch_no: string | null;
  expiry: string | null;
  expiry_date: string | null;
  qty: number;
  mrp_paise: number;
  ptr_paise: number;
  shop_id: string | null;
}

/** A batch enriched with derived expiry + valuation fields. */
export interface EnrichedBatch extends BatchRow {
  expiryAt: Date | null;
  daysToExpiry: number | null;
  bucket: ExpiryBucket | null;
  costValuePaise: number; // qty × ptr (what it cost us)
  mrpValuePaise: number; // qty × mrp (retail value at risk)
}

/** Per-item aggregate across all its batches + its sale movement history. */
export interface ItemAgg {
  item_id: string;
  name: string;
  salt: string | null;
  manufacturer: string | null;
  pack: string | null;
  hsn: string | null;
  gst_rate: number;
  schedule: string;
  reorder_level: number;
  is_active: boolean;
  therapeutic_category: string | null;
  onHand: number; // Σ batch qty
  batchCount: number;
  costValuePaise: number; // Σ qty × ptr
  mrpValuePaise: number; // Σ qty × mrp
  avgPtrPaise: number; // last-known unit cost (max over batches), for reorder valuation
  lastMrpPaise: number; // last-known retail price (max over batches), for lost-sales valuation
  soldUnits: number; // net units sold in the lookback window (sales − returns)
  cogsWindowPaise: number; // Σ sold units × unit cost at sale time, in window
  lastSoldAt: Date | null;
  velocityPerDay: number; // soldUnits / lookbackDays
}

// ── Pure: enrichment + aggregation ───────────────────────────────────────────

/** One sale-side movement, as fetched from stock_movements. */
export interface SaleMovement {
  item_id: string;
  qty_delta: number; // signed: sale is negative, sale_return positive
  unit_cost_paise: number;
  reason: string; // 'sale' | 'sale_return'
  created_at: string;
}

export function enrichBatch(b: BatchRow, now: Date = new Date()): EnrichedBatch {
  const expiryAt = parseExpiry(b.expiry_date, b.expiry);
  const daysToExpiry = daysUntil(expiryAt, now);
  return {
    ...b,
    expiryAt,
    daysToExpiry,
    bucket: expiryBucket(daysToExpiry),
    costValuePaise: b.qty * b.ptr_paise,
    mrpValuePaise: b.qty * b.mrp_paise,
  };
}

/**
 * Fold batches + sale movements into per-item aggregates. `lookbackDays` is the
 * window the movements cover, used to turn units sold into a per-day velocity.
 */
export function aggregateItems(
  batches: BatchRow[],
  movements: SaleMovement[],
  lookbackDays: number = LOOKBACK_DAYS,
): ItemAgg[] {
  const byItem = new Map<string, ItemAgg>();

  const seed = (b: BatchRow): ItemAgg => ({
    item_id: b.item_id,
    name: b.name,
    salt: b.salt,
    manufacturer: b.manufacturer,
    pack: b.pack,
    hsn: b.hsn,
    gst_rate: b.gst_rate,
    schedule: b.schedule,
    reorder_level: b.reorder_level,
    is_active: b.is_active,
    therapeutic_category: b.therapeutic_category,
    onHand: 0,
    batchCount: 0,
    costValuePaise: 0,
    mrpValuePaise: 0,
    avgPtrPaise: 0,
    lastMrpPaise: 0,
    soldUnits: 0,
    cogsWindowPaise: 0,
    lastSoldAt: null,
    velocityPerDay: 0,
  });

  for (const b of batches) {
    let agg = byItem.get(b.item_id);
    if (!agg) {
      agg = seed(b);
      byItem.set(b.item_id, agg);
    }
    agg.onHand += b.qty;
    agg.batchCount += 1;
    agg.costValuePaise += b.qty * b.ptr_paise;
    agg.mrpValuePaise += b.qty * b.mrp_paise;
    agg.avgPtrPaise = Math.max(agg.avgPtrPaise, b.ptr_paise);
    agg.lastMrpPaise = Math.max(agg.lastMrpPaise, b.mrp_paise);
  }

  for (const m of movements) {
    const agg = byItem.get(m.item_id);
    if (!agg) continue; // a sold item with no remaining batch row — skip (no on-hand context)
    const soldUnits = -m.qty_delta; // sale (neg delta) → +units; return (pos) → −units
    agg.soldUnits += soldUnits;
    agg.cogsWindowPaise += soldUnits * m.unit_cost_paise;
    if (m.reason === "sale") {
      const t = new Date(m.created_at);
      if (!Number.isNaN(t.getTime()) && (!agg.lastSoldAt || t > agg.lastSoldAt)) agg.lastSoldAt = t;
    }
  }

  const days = Math.max(1, lookbackDays);
  for (const agg of byItem.values()) {
    agg.velocityPerDay = Math.max(0, agg.soldUnits) / days;
  }
  return [...byItem.values()];
}

// ── Pure: per-view derivations ────────────────────────────────────────────

/** Days since an item last sold (within the lookback window). null = no sale seen. */
export function daysSinceSold(agg: ItemAgg, now: Date = new Date()): number | null {
  if (!agg.lastSoldAt) return null;
  return Math.floor((now.getTime() - agg.lastSoldAt.getTime()) / MS_PER_DAY);
}

/**
 * Dead / slow stock: on-hand items with no sale in the last `n` days. Because the
 * movement window is `lookbackDays`, an item with no sale at all in that window is
 * dead for any `n ≤ lookbackDays`. Sorted by capital tied up (cost value) desc.
 */
export function deadStock(items: ItemAgg[], n: number, now: Date = new Date()): ItemAgg[] {
  return items
    .filter((it) => it.onHand > 0)
    .filter((it) => {
      const d = daysSinceSold(it, now);
      return d == null || d > n;
    })
    .sort((a, b) => b.costValuePaise - a.costValuePaise);
}

/** Suggested reorder quantity: cover `coverDays` of velocity, less what's on hand, floored to the reorder gap. */
export function suggestedOrderQty(agg: ItemAgg, coverDays = 30): number {
  const demand = Math.ceil(agg.velocityPerDay * coverDays);
  const toLevel = Math.max(agg.reorder_level, demand);
  return Math.max(0, toLevel - agg.onHand);
}

/** Items at or below their reorder level (reorder_level > 0), neediest first. */
export function reorderList(items: ItemAgg[]): ItemAgg[] {
  return items
    .filter((it) => it.reorder_level > 0 && it.onHand <= it.reorder_level)
    .sort((a, b) => a.onHand - b.onHand - (b.reorder_level - a.reorder_level));
}

/** Out-of-stock items that have shown demand (sold in window) — i.e. losing sales, fastest-moving first. */
export function outOfStock(items: ItemAgg[]): ItemAgg[] {
  return items
    .filter((it) => it.onHand <= 0 && it.soldUnits > 0)
    .sort((a, b) => b.velocityPerDay - a.velocityPerDay);
}

/**
 * Rough lost-sales estimate for an out-of-stock item: project its recent velocity
 * across the days since it last sold (≈ the stock-out duration). Revenue is valued
 * at the last-known MRP. Both clamp to ≥ 0.
 */
export function lostSalesEstimate(
  agg: ItemAgg,
  now: Date = new Date(),
): { units: number; revenuePaise: number } {
  const idle = daysSinceSold(agg, now) ?? 0;
  const units = Math.max(0, Math.round(agg.velocityPerDay * idle));
  return { units, revenuePaise: units * agg.lastMrpPaise };
}

/**
 * Annualised stock-turnover ratio: COGS over the window, scaled to a year, divided
 * by the current inventory value at cost. 0 when nothing is on hand. A higher ratio
 * means stock cycles faster (capital works harder).
 */
export function turnoverRatio(
  cogsWindowPaise: number,
  inventoryValuePaise: number,
  lookbackDays: number = LOOKBACK_DAYS,
): number {
  if (inventoryValuePaise <= 0) return 0;
  const annualCogs = cogsWindowPaise * (365 / Math.max(1, lookbackDays));
  return annualCogs / inventoryValuePaise;
}

/** Group key for the turnover breakdown. */
export type TurnoverDim = "item" | "category" | "manufacturer";

export interface TurnoverGroup {
  key: string;
  label: string;
  cogsWindowPaise: number;
  inventoryValuePaise: number;
  ratio: number;
}

/** Aggregate items into turnover groups along a dimension, highest-COGS first. */
export function turnoverBy(
  items: ItemAgg[],
  dim: TurnoverDim,
  lookbackDays: number = LOOKBACK_DAYS,
): TurnoverGroup[] {
  const pick = (it: ItemAgg): string =>
    dim === "item" ? it.name : (dim === "category" ? it.therapeutic_category : it.manufacturer) || "—";
  const by = new Map<string, TurnoverGroup>();
  for (const it of items) {
    const label = pick(it);
    let g = by.get(label);
    if (!g) {
      g = { key: label, label, cogsWindowPaise: 0, inventoryValuePaise: 0, ratio: 0 };
      by.set(label, g);
    }
    g.cogsWindowPaise += it.cogsWindowPaise;
    g.inventoryValuePaise += it.costValuePaise;
  }
  const groups = [...by.values()];
  for (const g of groups) g.ratio = turnoverRatio(g.cogsWindowPaise, g.inventoryValuePaise, lookbackDays);
  return groups.sort((a, b) => b.cogsWindowPaise - a.cogsWindowPaise);
}

// ── The hook ────────────────────────────────────────────────────────────────

interface UseInventory {
  batches: EnrichedBatch[];
  items: ItemAgg[];
  loading: boolean;
  error: string | null;
  lookbackDays: number;
  /** Re-fetch from the server (call after a stock mutation). */
  reload: () => void;
}

/** Raw PostgREST row shape for the batches+item embed. */
interface RawBatch {
  id: string;
  item_id: string;
  batch_no: string | null;
  expiry: string | null;
  expiry_date: string | null;
  qty: number;
  mrp_paise: number;
  ptr_paise: number;
  shop_id: string | null;
  item: {
    name: string;
    salt: string | null;
    manufacturer: string | null;
    pack: string | null;
    hsn: string | null;
    gst_rate: number;
    schedule: string;
    reorder_level: number;
    is_active: boolean;
    therapeutic_category: string | null;
  } | null;
}

function toBatchRow(r: RawBatch): BatchRow {
  return {
    batch_id: r.id,
    item_id: r.item_id,
    name: r.item?.name ?? "—",
    salt: r.item?.salt ?? null,
    manufacturer: r.item?.manufacturer ?? null,
    pack: r.item?.pack ?? null,
    hsn: r.item?.hsn ?? null,
    gst_rate: r.item?.gst_rate ?? 0,
    schedule: r.item?.schedule ?? "OTC",
    reorder_level: r.item?.reorder_level ?? 0,
    is_active: r.item?.is_active ?? true,
    therapeutic_category: r.item?.therapeutic_category ?? null,
    batch_no: r.batch_no,
    expiry: r.expiry,
    expiry_date: r.expiry_date,
    qty: r.qty ?? 0,
    mrp_paise: r.mrp_paise ?? 0,
    ptr_paise: r.ptr_paise ?? 0,
    shop_id: r.shop_id,
  };
}

/**
 * Fetch the org's stock once and expose it two ways: enriched per-batch rows
 * (stock ledger, near-expiry) and per-item aggregates (dead stock, reorder,
 * out-of-stock, turnover). One batches+item fetch + one bounded sale-movement
 * fetch covering the last `LOOKBACK_DAYS`.
 */
export function useInventory(): UseInventory {
  const orgId = useAuth().membership?.orgId;
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [movements, setMovements] = useState<SaleMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const since = new Date(Date.now() - LOOKBACK_DAYS * MS_PER_DAY).toISOString();

    Promise.all([
      supabase
        .from("batches")
        .select(
          "id,item_id,batch_no,expiry,expiry_date,qty,mrp_paise,ptr_paise,shop_id,item:items(name,salt,manufacturer,pack,hsn,gst_rate,schedule,reorder_level,is_active,therapeutic_category)",
        )
        .eq("org_id", orgId)
        .limit(5000),
      supabase
        .from("stock_movements")
        .select("item_id,qty_delta,unit_cost_paise,reason,created_at")
        .eq("org_id", orgId)
        .in("reason", ["sale", "sale_return"])
        .gte("created_at", since)
        .limit(20000),
    ]).then(([batchRes, moveRes]) => {
      if (!active) return;
      setError(batchRes.error?.message ?? moveRes.error?.message ?? null);
      setBatchRows(((batchRes.data as unknown as RawBatch[] | null) ?? []).map(toBatchRow));
      setMovements((moveRes.data as unknown as SaleMovement[] | null) ?? []);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [orgId, nonce]);

  const batches = useMemo(() => {
    const now = new Date();
    return batchRows.map((b) => enrichBatch(b, now));
  }, [batchRows]);

  const items = useMemo(
    () => aggregateItems(batchRows, movements, LOOKBACK_DAYS),
    [batchRows, movements],
  );

  return { batches, items, loading, error, lookbackDays: LOOKBACK_DAYS, reload };
}
