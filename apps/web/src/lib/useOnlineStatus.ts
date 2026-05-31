import { useSyncExternalStore } from "react";

/**
 * Browser connectivity, tracked via the window online/offline events and seeded
 * from `navigator.onLine`. Uses `useSyncExternalStore` so there is no effect lag
 * or tearing.
 *
 * Best-effort only: `navigator.onLine` reflects whether a network interface is
 * up, not whether Supabase is actually reachable — it catches the common cases
 * (wifi drop, cable unplugged, airplane mode) but can read "online" on a dead
 * link. Good enough for a connectivity hint; not a substitute for the offline
 * sync substrate (the SALT-135 epic).
 */
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

const getSnapshot = () => navigator.onLine;
const getServerSnapshot = () => true;

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
