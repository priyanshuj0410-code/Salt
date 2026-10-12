import { supabase } from "./supabase";

/**
 * Client telemetry (SALT-36) — fire-and-forget events into public.client_events.
 * activity_events / audit_log are server-written and success-only, so they cannot
 * see a bill blocked / queued-never-synced / parked / failed during an outage.
 * These events fill that gap so we can answer "are outages losing bills?".
 *
 * HARD RULE: emit MUST NEVER throw or block. It is called from the billing write
 * path and the outbox flush — a telemetry failure can never regress a bill save.
 *
 * LIMITATION (read before trusting absolute counts): events insert only while the
 * device is ONLINE. The offline bill events ride the outbox flush on reconnect
 * (occurredAt back-dated to enqueue time). A bill queued on a device that NEVER
 * reconnects emits nothing — but such a bill is also genuinely lost (its outbox
 * record never replays), and that catastrophic case is covered by the founder
 * interview, not this instrument. So `offline_bill_parked` is the reliable primary
 * loss signal; "queued minus synced" is only a soft upper bound. Timestamps mix
 * clocks by design: bill_queued_offline.occurred_at is enqueue time; synced/parked
 * default to emit time.
 */

export type ClientEventName =
  | "bill_queued_offline"   // a bill rode an outage (queued to the outbox)
  | "offline_bill_synced"   // that queued bill later reached the server, NOT lost
  | "offline_bill_parked"   // queued bill went poison after maxAttempts, likely LOST
  | "bill_save_failed"      // online save definitively rejected (server rollback)
  | "bill_save_timeout";    // online save timed out, may be lost on a dead link

interface TelemetryContext {
  orgId: string | null;
  actorId: string | null;
  shopId: string | null;
}

// Resolved once membership is known, so non-React callers (the outbox flush) can
// attribute events without prop-drilling org/actor through the pure queue layer.
const ctx: TelemetryContext = { orgId: null, actorId: null, shopId: null };

export function setTelemetryContext(next: Partial<TelemetryContext>): void {
  Object.assign(ctx, next);
}

export interface ClientEventFields {
  billRef?: string | null;
  amountPaise?: number | null;
  occurredAt?: string; // client ISO timestamp; defaults to now
  meta?: Record<string, unknown>;
}

export function emitClientEvent(name: ClientEventName, fields: ClientEventFields = {}): void {
  try {
    if (!supabase || !ctx.orgId) return; // no session/org yet: drop silently
    const row = {
      org_id: ctx.orgId,
      shop_id: ctx.shopId,
      actor_id: ctx.actorId,
      name,
      bill_ref: fields.billRef ?? null,
      amount_paise: fields.amountPaise ?? null,
      occurred_at: fields.occurredAt ?? new Date().toISOString(),
      meta: fields.meta ?? {},
    };
    // Not awaited; swallow any rejection so a dead link can never surface here.
    void supabase.from("client_events").insert(row).then(undefined, () => {});
  } catch {
    /* telemetry must never break a bill */
  }
}
