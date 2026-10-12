import { addDays, format } from "date-fns";
import { Banknote, CalendarClock, CreditCard, Landmark, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPaise } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { TENDER_MODES, type TenderAmounts, type TenderCheck, type TenderMode } from "@/lib/tenders";

const MODE_META: Record<TenderMode, { label: string; Icon: typeof Banknote }> = {
  cash: { label: "Cash", Icon: Banknote },
  card: { label: "Card", Icon: CreditCard },
  upi: { label: "UPI", Icon: Smartphone },
  bank: { label: "Bank", Icon: Landmark },
  credit: { label: "Credit", Icon: CalendarClock },
};

const CREDIT_PRESETS = [7, 15, 30];

/** A rupee amount input bound to integer paise (the underlying money unit). */
function RupeeInput({
  paise,
  onPaise,
  label,
}: {
  paise: number;
  onPaise: (paise: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-text-tertiary">₹</span>
      <input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        aria-label={label}
        value={paise ? paise / 100 : ""}
        placeholder="0"
        onChange={(e) => onPaise(Math.round((parseFloat(e.target.value) || 0) * 100))}
        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums focus-visible:border-ring"
      />
    </div>
  );
}

/**
 * Split-tender pane (SALT-198): one row per settlement mode, a live remainder, and —
 * when there is a credit leg — the repayment period. The legs must sum **exactly** to
 * the bill total before Save is allowed (the server re-validates). Shared by the
 * desktop summary and the mobile checkout via the `checkout` hook's split API.
 */
export function SplitTender({
  amounts,
  setAmount,
  fillRemainder,
  check,
  creditDays,
  setCreditDays,
  hasParty,
}: {
  amounts: TenderAmounts;
  setAmount: (mode: TenderMode, paise: number) => void;
  fillRemainder: (mode: TenderMode) => void;
  check: TenderCheck;
  creditDays: number;
  setCreditDays: (days: number) => void;
  hasParty: boolean;
}) {
  const { remainderPaise } = check;
  const balanced = remainderPaise === 0;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border p-2.5">
      {TENDER_MODES.map((mode) => {
        const { label, Icon } = MODE_META[mode];
        return (
          <div key={mode} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm">
              <Icon className="size-4 text-text-tertiary" />
              {label}
            </span>
            <div className="flex items-center gap-1.5">
              <RupeeInput paise={amounts[mode]} onPaise={(p) => setAmount(mode, p)} label={`${label} amount`} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                // Disabled once balanced unless this leg owns the remainder already.
                disabled={remainderPaise <= 0 && amounts[mode] === 0}
                onClick={() => fillRemainder(mode)}
                title="Put the remaining amount here"
              >
                = rest
              </Button>
            </div>
          </div>
        );
      })}

      <div
        className={cn(
          "flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm font-medium",
          balanced ? "bg-success-bg text-success" : "bg-warning-bg text-warning",
        )}
      >
        <span>{balanced ? "Balanced" : remainderPaise > 0 ? "Remaining" : "Over by"}</span>
        <span className="tabular-nums">
          {balanced ? formatPaise(0) : formatPaise(Math.abs(remainderPaise))}
        </span>
      </div>

      {amounts.credit > 0 && (
        <div className="rounded-md border border-border p-2.5">
          <p className="mb-1.5 text-xs text-text-tertiary">Repayment period (credit portion)</p>
          {hasParty ? (
            <>
              <div className="flex items-center gap-1.5">
                {CREDIT_PRESETS.map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={creditDays === d ? "secondary" : "outline"}
                    onClick={() => setCreditDays(d)}
                  >
                    {d}d
                  </Button>
                ))}
                <input
                  type="number"
                  min={1}
                  value={creditDays}
                  onChange={(e) => setCreditDays(Number(e.target.value) || 0)}
                  aria-label="Custom repayment days"
                  className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums focus-visible:border-ring"
                />
                <span className="text-sm text-text-tertiary">days</span>
              </div>
              <p className="mt-1.5 text-xs text-text-tertiary">
                Credit portion due by{" "}
                <span className="font-medium text-text-primary">
                  {format(addDays(new Date(), creditDays), "d MMM yyyy")}
                </span>
              </p>
            </>
          ) : (
            <p className="text-xs text-warning">Pick a customer to take a credit portion.</p>
          )}
        </div>
      )}
    </div>
  );
}
