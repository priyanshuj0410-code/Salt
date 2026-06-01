import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { IndexedDbOutboxStore, InMemoryOutboxStore, Outbox, type OutboxStore } from "./offline";
import { useOnlineStatus } from "./useOnlineStatus";

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

export const outbox = new Outbox(makeStore(), refresh);

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
