/**
 * Inter-shop transfer write path (SALT-042). Thin typed contract to the
 * `receive_transfer` RPC (0030) plus small hooks to list the org's shops and the
 * transfer history. Multi-shop management (creating/switching shops) is SALT-090;
 * this moves stock between any two of them.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export interface ShopRef {
  id: string;
  name: string;
  code: string | null;
  is_primary: boolean;
}

export interface TransferLineInput {
  batch_id: string;
  qty: number;
}

export interface TransferRow {
  id: string;
  from_shop_id: string;
  to_shop_id: string;
  transfer_no: string | null;
  status: string;
  created_at: string;
}

/** All shops in the caller's org (RLS lets a member read every shop in the org). */
export function useShops() {
  const orgId = useAuth().membership?.orgId;
  const [shops, setShops] = useState<ShopRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("shops")
      .select("id,name,code,is_primary")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setShops((data as unknown as ShopRef[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  return { shops, loading };
}

/** Move stock from one shop to another via the receive_transfer RPC. Returns the transfer id. */
export async function receiveTransfer(
  fromShop: string,
  toShop: string,
  lines: TransferLineInput[],
  notes: string | null,
): Promise<string> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("receive_transfer", {
    p_from_shop: fromShop,
    p_to_shop: toShop,
    p_lines: lines,
    p_transfer_no: null,
    p_notes: notes,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Transfer history for the org, newest first, with a reload. */
export function useTransfers() {
  const orgId = useAuth().membership?.orgId;
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    supabase
      .from("stock_transfers")
      .select("id,from_shop_id,to_shop_id,transfer_no,status,created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!active) return;
        setRows((data as unknown as TransferRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId, nonce]);

  return { rows, loading, reload };
}
