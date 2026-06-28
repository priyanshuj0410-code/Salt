import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { IndexedDbOutboxStore, InMemoryOutboxStore, Outbox, type OutboxRecord, type OutboxStore } from "./offline";
import { useOnlineStatus } from "./useOnlineStatus";
import { emitClientEvent } from "./clientEvents";

/**
 * Browser singleton + React bindings for the offline write outbox (SALT-100).
 * Pure queue logic lives in `./offline`; this file wires it to the real browser
 * (IndexedDB storage, a reactive pending count, online-aware auto-flush).
 *
 * Consumers (e.g. billing) use the singleton:
 *   outbox.register("create_sales_invoice", (p) => supabase.rpc("create_sales_invoice", p));
 *   await outbox.enqueue("create_sales_invoice", payload);   // offline-safe
 * and the UI uses `useOutbox()` / `usePendingWrites()`.
 */

function makeStore(): OutboxStore {
  try {
    if (typeof indexedDB !== "undefined") return new IndexedDbOutboxStore();
  } catch {
    /* private-mode / disabled IndexedDB → fall back to memory */
  }
  return new InMemoryOutboxStore();
}

const listeners = new Set<() => void>();
let pendingCount = 0;

function refresh() {
  void outbox.pending().then((n) => {
    if (n !== pendingCount) {
      pendingCount = n;
      for (const l of listeners) l();
    }
  });
}

/** Money-at-risk stamped on the record at enqueue time (offline branch of useCheckout). */
const amountOf = (rec: OutboxRecord): number | null =>
  typeof rec.meta?.amountPaise === "number" ? rec.meta.amountPaise : null;

/** Map raw RPC error text to a controlled reason code — avoids unbounded server
 *  strings (which can embed batch/product ids) in telemetry. */
const reasonCode = (msg?: string): string =>
  !msg ? "rpc_error" : /insufficient stock/i.test(msg) ? "oversell" : /timeout|network|fetch|failed to fetch/i.test(msg) ? "network" : "rpc_error";

// SALT-36 telemetry: observe the queue lifecycle so we can measure bills LOST to
// outages (parked) vs ridden-through (synced). Fire-and-forget; never blocks flush.
export const outbox = new Outbox(makeStore(), refresh, {
  onReplayStart: (rec) =>
    emitClientEvent("bill_queued_offline", {
      billRef: rec.id,
      amountPaise: amountOf(rec),
      occurredAt: rec.createdAt,
      meta: { kind: rec.kind },
    }),
  onSynced: (rec) =>
    emitClientEvent("offline_bill_synced", {
      billRef: rec.id,
      amountPaise: amountOf(rec),
      meta: { kind: rec.kind, priorFailures: rec.attempts, queuedAt: rec.createdAt },
    }),
  onParked: (rec) =>
    emitClientEvent("offline_bill_parked", {
      billRef: rec.id,
      amountPaise: amountOf(rec),
      meta: { kind: rec.kind, priorFailures: rec.attempts, reason: reasonCode(rec.lastError), queuedAt: rec.createdAt },
    }),
});

// Seed the cached count once at startup.
refresh();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive count of writes waiting to sync. */
export function usePendingWrites(): number {
  return useSyncExternalStore(subscribe, () => pendingCount, () => 0);
}

/** Connectivity + pending count + a manual flush; auto-flushes on reconnect. */
export function useOutbox() {
  const online = useOnlineStatus();
  const pending = usePendingWrites();
  const [flushing, setFlushing] = useState(false);

  const flush = useCallback(async () => {
    setFlushing(true);
    try {
      await outbox.flush();
    } finally {
      setFlushing(false);
    }
  }, []);

  // Replay automatically when connectivity returns (and on mount if online).
  useEffect(() => {
    if (!online) return;
    let active = true;
    (async () => {
      const n = await outbox.pending();
      if (!active || n === 0) return;
      setFlushing(true);
      try {
        await outbox.flush();
      } finally {
        if (active) setFlushing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [online]);

  return { online, pending, flushing, flush };
}
