import { cn } from "@/lib/utils";
import { formatPaise } from "@/lib/currency";
import { AGING_BANDS, type AgingBuckets } from "@/lib/aging";

/**
 * Receivable / payable outstanding split into 0-30 / 31-60 / 61-90 / 90+ day
 * bands. Render only when at least one side has a total — an empty body looks
 * broken; callers guard on `receivable.total || payable.total`.
 */
export function AgingTable({ receivable, payable }: { receivable: AgingBuckets; payable: AgingBuckets }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-text-tertiary">
            <th className="py-1 text-left font-medium"></th>
            {AGING_BANDS.map((b) => (
              <th key={b.key} className="px-2 py-1 text-right font-medium">
                {b.label}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {receivable.total > 0 && <Row label="Receivable" buckets={receivable} />}
          {payable.total > 0 && <Row label="Payable" buckets={payable} />}
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, buckets }: { label: string; buckets: AgingBuckets }) {
  return (
    <tr className="border-t border-divider">
      <td className="py-1.5 text-left text-text-secondary">{label}</td>
      {AGING_BANDS.map((b) => {
        const v = buckets[b.key];
        return (
          <td
            key={b.key}
            className={cn(
              "px-2 py-1.5 text-right",
              v === 0 ? "text-text-tertiary" : b.key === "d90_plus" ? "text-danger" : "",
            )}
          >
            {v === 0 ? "—" : formatPaise(v)}
          </td>
        );
      })}
      <td className="px-2 py-1.5 text-right font-medium">{formatPaise(buckets.total)}</td>
    </tr>
  );
}
