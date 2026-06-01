import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Non-blocking idle-logout warning (SALT-115). Pinned top-centre, it never traps
 * focus or blocks the counter: the wrapper is `pointer-events-none` so clicks
 * pass through to the page behind it, and only the banner itself is interactive.
 * Any activity (handled in AuthProvider) — or the explicit button — dismisses it.
 */
export function IdleWarningDialog({
  secondsLeft,
  onStay,
}: {
  secondsLeft: number;
  onStay: () => void;
}) {
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3">
      <div
        role="alert"
        className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-background px-4 py-2.5 text-sm shadow-lg"
      >
        <Clock className="size-4 shrink-0 text-text-tertiary" aria-hidden />
        <span className="text-foreground">
          Signing out due to inactivity in{" "}
          <span aria-hidden className="font-mono font-semibold tabular-nums">
            {mm}:{ss}
          </span>
        </span>
        <Button size="sm" onClick={onStay}>
          Stay signed in
        </Button>
      </div>
    </div>
  );
}
