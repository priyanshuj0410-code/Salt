import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * The one real-time primitive the multi-counter substrate is built on: subscribe
 * to INSERTs on a table via Supabase Realtime (Postgres Changes), optionally
 * filtered, RLS-enforced. Every live feature — activity feed, internal messages,
 * (future) approvals — rides this helper; point it at a table + filter.
 *
 * Returns an unsubscribe fn; call it on unmount.
 */
export function subscribeTableInserts<T>(opts: {
  /** Unique channel name (one channel per logical subscription). */
  channel: string;
  table: string;
  /** Postgres-changes filter, e.g. `org_id=eq.${orgId}`. Omit for none. */
  filter?: string;
  onInsert: (row: T) => void;
  onStatus?: (connected: boolean) => void;
}): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const ch: RealtimeChannel = sb
    .channel(opts.channel)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: opts.table,
        ...(opts.filter ? { filter: opts.filter } : {}),
      },
      (payload) => opts.onInsert(payload.new as T),
    )
    .subscribe((status) => opts.onStatus?.(status === "SUBSCRIBED"));
  return () => {
    void sb.removeChannel(ch);
  };
}

export type RowChangeEvent = "INSERT" | "UPDATE" | "DELETE";

/**
 * Like {@link subscribeTableInserts} but for INSERTs *and* UPDATEs (and DELETEs)
 * — needed when state changes after creation, e.g. an approval going
 * pending → approved. `onChange` receives the row (the new record, or the old
 * one on DELETE) and the event type.
 */
export function subscribeTableChanges<T>(opts: {
  channel: string;
  table: string;
  filter?: string;
  /** Defaults to "*" (all of INSERT/UPDATE/DELETE). */
  event?: "*" | RowChangeEvent;
  onChange: (row: T, eventType: RowChangeEvent) => void;
  onStatus?: (connected: boolean) => void;
}): () => void {
  const sb = supabase;
  if (!sb) return () => {};
  const ch: RealtimeChannel = sb
    .channel(opts.channel)
    .on(
      "postgres_changes",
      {
        event: opts.event ?? "*",
        schema: "public",
        table: opts.table,
        ...(opts.filter ? { filter: opts.filter } : {}),
      },
      (payload) => opts.onChange((payload.new ?? payload.old) as T, payload.eventType as RowChangeEvent),
    )
    .subscribe((status) => opts.onStatus?.(status === "SUBSCRIBED"));
  return () => {
    void sb.removeChannel(ch);
  };
}
