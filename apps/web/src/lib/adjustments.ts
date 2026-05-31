/**
 * Stock-adjustment write path (SALT-040). The arithmetic is trivial; the value is
 * the typed contract to the `adjust_stock` RPC (0028) and the human reason → DB
 * reason mapping. The DB only stores 'adjustment' | 'writeoff'; the finer human
 * reason (breakage, theft, …) is preserved in the movement note so the audit
 * trail reads back the way it was entered.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/** A selectable adjustment reason: how a magnitude entered in the form is applied. */
export interface AdjustKind {
  key: string;
  label: string;
  dbReason: "adjustment" | "writeoff";
  sign: 1 | -1;
}

export const ADJUST_KINDS: AdjustKind[] = [
  { key: "breakage", label: "Breakage / damage", dbReason: "writeoff", sign: -1 },
  { key: "theft", label: "Theft / loss", dbReason: "writeoff", sign: -1 },
  { key: "expiry", label: "Expired (write-off)", dbReason: "writeoff", sign: -1 },
  { key: "found", label: "Found (undercount +)", dbReason: "adjustment", sign: 1 },
  { key: "correction", label: "Correction (−)", dbReason: "adjustment", sign: -1 },
];

/** Compose the movement note so the audit trail shows the human reason + free text. */
export function adjustmentNote(kind: AdjustKind, note: string): string {
  const extra = note.trim();
  return extra ? `${kind.label} — ${extra}` : kind.label;
}

/** Apply a stock adjustment to one batch via the adjust_stock RPC. Returns the movement id. */
export async function adjustStock(
  batchId: string,
  qtyDelta: number,
  dbReason: "adjustment" | "writeoff",
  note: string | null,
): Promise<string> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("adjust_stock", {
    p_batch_id: batchId,
    p_qty_delta: qtyDelta,
    p_reason: dbReason,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** One row in the adjustment audit log (a stock_movement with item/batch joined). */
export interface AdjustmentLogRow {
  id: string;
  qty_delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  item: { name: string } | null;
  batch: { batch_no: string | null } | null;
}

interface RawLogRow {
  id: string;
  qty_delta: number;
  reason: string;
  note: string | null;
  created_at: string;
  item: { name: string } | null;
  batch: { batch_no: string | null } | null;
}

/** Recent adjustment / write-off movements for the org, newest first, with a reload. */
export function useAdjustmentLog(limit = 100) {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<AdjustmentLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("stock_movements")
      .select("id,qty_delta,reason,note,created_at,item:items(name),batch:batches(batch_no)")
      .eq("org_id", orgId)
      .in("reason", ["adjustment", "writeoff"])
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => {
        if (!active) return;
        setRows(((data as unknown as RawLogRow[] | null) ?? []) as AdjustmentLogRow[]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, nonce, limit]);

  return { rows, loading, reload };
}
