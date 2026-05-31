import { supabase } from "./supabase";
import { subscribeTableInserts } from "./realtime";

/**
 * Internal messages (SALT-105) — data + real-time layer.
 *
 * A thread is (entity_type, entity_id): staff notes/chat attached to a bill,
 * customer or item, delivered live across counters on the shared per-org
 * Postgres-changes primitive. Authorship is stamped server-side (migration 0029).
 */

export type MessageEntityType = "sales_invoice" | "purchase" | "payment" | "customer" | "item";

export interface EntityMessage {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

const COLS = "id,org_id,entity_type,entity_id,body,author_id,author_name,created_at";

/** Oldest-first thread for one entity. */
export async function fetchMessages(
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<EntityMessage[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("entity_messages")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  return (data as EntityMessage[] | null) ?? [];
}

/** Post a message. author_id/name are stamped server-side from the JWT. */
export async function postMessage(input: {
  orgId: string;
  entityType: string;
  entityId: string;
  body: string;
}): Promise<EntityMessage | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("entity_messages")
    .insert({
      org_id: input.orgId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      body: input.body,
    })
    .select(COLS)
    .single();
  return (data as EntityMessage | null) ?? null;
}

/**
 * Subscribe to live inserts for one thread. Filters on entity_id (a uuid, so
 * unique across entity types); RLS scopes to the org. The caller should still
 * guard on entity_type for defensiveness.
 */
export function subscribeMessages(
  orgId: string,
  entityType: string,
  entityId: string,
  onInsert: (m: EntityMessage) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  return subscribeTableInserts<EntityMessage>({
    channel: `messages:${orgId}:${entityType}:${entityId}`,
    table: "entity_messages",
    filter: `entity_id=eq.${entityId}`,
    onInsert,
    onStatus,
  });
}
