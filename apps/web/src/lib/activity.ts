import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Shop-wide activity feed (SALT-104) — data + real-time layer.
 *
 * `activity_events` is an append-only log written server-side by triggers on
 * sales / payments / purchases (migration 0028), so every counter's actions show
 * up live on every other counter. This module is the reusable real-time
 * primitive the multi-counter features build on: a per-org Postgres-changes
 * channel over Supabase Realtime.
 */

export type ActivityKind = "sale" | "purchase" | "payment_in" | "payment_out";

export interface ActivityEvent {
  id: string;
  org_id: string;
  /** ActivityKind in practice; typed wide to tolerate future kinds gracefully. */
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  party_id: string | null;
  party_name: string | null;
  title: string;
  amount_paise: number | null;
  ref: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

const COLS =
  "id,org_id,kind,entity_type,entity_id,actor_id,actor_name,party_id,party_name,title,amount_paise,ref,meta,created_at";

/** Newest-first window of recent shop activity. */
export async function fetchRecentActivity(orgId: string, limit = 200): Promise<ActivityEvent[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("activity_events")
    .select(COLS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ActivityEvent[] | null) ?? [];
}

/**
 * Subscribe to live activity inserts for one org. Calls `onInsert` with each new
 * event and `onStatus` with the channel's connected state. Returns an unsubscribe
 * fn — call it on unmount. This is the substrate other real-time features reuse:
 * swap the table to ride the same per-org channel pattern.
 */
export function subscribeActivity(
  orgId: string,
  onInsert: (e: ActivityEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const channel: RealtimeChannel = sb
    .channel(`activity:${orgId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_events", filter: `org_id=eq.${orgId}` },
      (payload) => onInsert(payload.new as ActivityEvent),
    )
    .subscribe((status) => onStatus?.(status === "SUBSCRIBED"));
  return () => {
    void sb.removeChannel(channel);
  };
}
