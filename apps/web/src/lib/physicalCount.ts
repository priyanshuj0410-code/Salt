/**
 * Physical-count write path (SALT-039). A count is a persisted document
 * (physical_counts + physical_count_lines, 0016): on start we snapshot current
 * on-hand into lines (system_qty), the user edits counted_qty, and finalizing
 * posts an 'adjustment' movement per non-zero variance and sets on-hand to the
 * counted figure (finalize_physical_count, 0028). Lines are written client-side
 * under RLS while the count is a draft; only the posting is centralised.
 */
import { supabase } from "@/lib/supabase";

export interface PhysicalCount {
  id: string;
  count_date: string;
  status: "draft" | "finalized";
  created_at: string;
}

export interface CountLine {
  id: string;
  item_id: string;
  batch_id: string | null;
  system_qty: number;
  counted_qty: number;
  variance: number;
  item: { name: string } | null;
  batch: { batch_no: string | null } | null;
}

/** A batch to snapshot into a new count. */
export interface SnapshotBatch {
  item_id: string;
  batch_id: string;
  qty: number;
}

/** Start a draft count for a shop, snapshotting the given on-hand batches as lines. */
export async function createPhysicalCount(
  orgId: string,
  shopId: string,
  batches: SnapshotBatch[],
): Promise<string> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("physical_counts")
    .insert({ org_id: orgId, shop_id: shopId, status: "draft" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const countId = (data as { id: string }).id;

  if (batches.length) {
    const lines = batches.map((b) => ({
      org_id: orgId,
      count_id: countId,
      item_id: b.item_id,
      batch_id: b.batch_id,
      system_qty: b.qty,
      counted_qty: b.qty,
    }));
    const { error: le } = await supabase.from("physical_count_lines").insert(lines);
    if (le) throw new Error(le.message);
  }
  return countId;
}

/** Persist an edited counted quantity for one draft line. */
export async function saveCountedQty(lineId: string, countedQty: number): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase
    .from("physical_count_lines")
    .update({ counted_qty: countedQty })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
}

/** Finalize a draft count → posts variance adjustments + sets on-hand. Returns lines adjusted. */
export async function finalizePhysicalCount(countId: string): Promise<number> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("finalize_physical_count", { p_count_id: countId });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}
