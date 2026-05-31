import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * App-wide connectivity hint. Salt's users are often on unreliable shop
 * internet, so a dropped connection should read as "you are offline" rather
 * than surfacing later as a mysterious failed save. Rendered once at the app
 * root; fixed-position, so it never shifts layout.
 *
 * This is the awareness layer only — actual offline billing / queued writes
 * need the sync substrate tracked under SALT-135.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-2 border-t border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>You are offline. Recent changes cannot be saved until the connection returns.</span>
    </div>
  );
}
