import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { flush, status, subscribe, type QueueIntent } from "@/lib/offline/writeQueue";

/**
 * Offline write-queue drain + depth, for the counter (SALT-202). Bills saved offline are committed
 * to the durable queue (`enqueue` in `useCheckout`); this drains them when connectivity returns,
 * replaying each intent with its idempotency key so a double-drain is **exactly-once** (0045). A
 * permanently-failing intent is parked by the queue (it doesn't deadlock the head) and surfaced as
 * "failed" so it can be dealt with. Returns the queue depth for the header sync indicator.
 */
const executor = async (intent: QueueIntent): Promise<void> => {
  if (!supabase) throw new Error("offline");
  const { error } = await supabase.rpc(intent.rpc, { ...intent.args, p_idempotency_key: intent.key });
  if (error) throw error;
};

export function useOfflineSync(): { online: boolean; pending: number; parked: number } {
  const online = useOnlineStatus();
  const [counts, setCounts] = useState({ pending: 0, parked: 0 });

  // Keep the depth current — re-read on any queue change (enqueue / flush).
  useEffect(() => {
    let active = true;
    const refresh = () => void status().then((c) => { if (active) setCounts(c); });
    refresh();
    const unsub = subscribe(refresh);
    return () => {
      active = false;
      unsub();
    };
  }, []);

  // Drain when connectivity returns (and on mount if already online with a backlog).
  useEffect(() => {
    if (!online) return;
    let active = true;
    void (async () => {
      const { pending } = await status();
      if (active && pending > 0) await flush(executor);
    })();
    return () => {
      active = false;
    };
  }, [online]);

  return { online, ...counts };
}
