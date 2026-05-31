import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { EnrichedBatch } from "@/lib/inventory";

/**
 * Expiry display shared by the stock-ledger and near-expiry tables: the
 * formatted expiry month plus a status chip once the batch is expired (danger)
 * or expiring within 60 days (warning). Beyond that, just the date.
 */
export function ExpiryCell({ b }: { b: EnrichedBatch }) {
  const label = b.expiryAt ? format(b.expiryAt, "MMM yyyy") : (b.expiry ?? "—");
  if (b.bucket === "expired") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="danger">Expired</Badge>
        <span className="text-text-tertiary">{label}</span>
      </span>
    );
  }
  if (b.bucket === "d30" || b.bucket === "d60") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="warning">{b.daysToExpiry}d</Badge>
        <span className="text-text-tertiary">{label}</span>
      </span>
    );
  }
  return <span className="text-text-tertiary">{label}</span>;
}
