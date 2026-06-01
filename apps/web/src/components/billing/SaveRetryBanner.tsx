import { X } from "lucide-react";

/**
 * Non-blocking banner for an optimistic save (SALT-155) that failed to reconcile with the server.
 * The bill is held off the counter (never lost); Retry re-sends it — offered only for definite
 * failures, which are idempotent because the server rolled back. A timeout shows no Retry (the
 * write may have landed; the cashier checks Bills first).
 */
export function SaveRetryBanner({
  message,
  retryable,
  onRetry,
  onDismiss,
}: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
      <span className="min-w-0 flex-1">{message}</span>
      <span className="flex shrink-0 items-center gap-3">
        {retryable && (
          <button type="button" onClick={onRetry} className="font-medium underline-offset-2 hover:underline">
            Retry
          </button>
        )}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="hover:opacity-70">
          <X className="size-3.5" />
        </button>
      </span>
    </div>
  );
}
