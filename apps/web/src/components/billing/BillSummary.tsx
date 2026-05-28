import { addDays, format } from "date-fns";
import { Banknote, CalendarClock, Printer, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatPaise } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { billTotals, useBill } from "@/store/bill";

const CREDIT_PRESETS = [7, 15, 30];

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={cn("tabular-nums", muted && "text-muted-foreground")}>{value}</span>
    </div>
  );
}

export function BillSummary() {
  const lines = useBill((s) => s.lines);
  const clear = useBill((s) => s.clear);
  const payment = useBill((s) => s.payment);
  const setPaymentMethod = useBill((s) => s.setPaymentMethod);
  const setCreditDays = useBill((s) => s.setCreditDays);
  const t = billTotals(lines);
  const empty = lines.length === 0;
  const marginPct = t.grand > 0 ? Math.round((t.margin / t.grand) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 overflow-auto rounded-lg border p-4">
      <Row label="Gross (MRP)" value={formatPaise(t.gross)} muted />
      {t.discount > 0 && <Row label="Discount" value={`− ${formatPaise(t.discount)}`} muted />}
      <Row label="Taxable value" value={formatPaise(t.taxable)} muted />
      <Row label="CGST" value={formatPaise(Math.round(t.gst / 2))} muted />
      <Row label="SGST" value={formatPaise(t.gst - Math.round(t.gst / 2))} muted />
      <Separator />
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Total payable</span>
        <span className="text-2xl font-semibold tabular-nums">{formatPaise(t.grand)}</span>
      </div>

      <div className="flex items-center justify-between rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-400">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <TrendingUp className="size-4" />
          Est. earnings
        </span>
        <span className="text-right">
          <span className="font-semibold tabular-nums">{formatPaise(t.margin)}</span>
          <span className="ml-1.5 text-xs tabular-nums opacity-80">{marginPct}%</span>
        </span>
      </div>

      <Separator />

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Payment</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={payment.method === "cash" ? "default" : "outline"}
            onClick={() => setPaymentMethod("cash")}
          >
            <Banknote />
            Cash
          </Button>
          <Button
            variant={payment.method === "credit" ? "default" : "outline"}
            onClick={() => setPaymentMethod("credit")}
          >
            <CalendarClock />
            Credit
          </Button>
        </div>

        {payment.method === "credit" && (
          <div className="mt-2 rounded-md border p-2.5">
            <p className="mb-1.5 text-xs text-muted-foreground">Repayment period</p>
            <div className="flex items-center gap-1.5">
              {CREDIT_PRESETS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={payment.creditDays === d ? "secondary" : "outline"}
                  onClick={() => setCreditDays(d)}
                >
                  {d}d
                </Button>
              ))}
              <input
                type="number"
                min={1}
                value={payment.creditDays}
                onChange={(e) => setCreditDays(Number(e.target.value) || 0)}
                aria-label="Custom repayment days"
                className="h-7 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Due by{" "}
              <span className="font-medium text-foreground">
                {format(addDays(new Date(), payment.creditDays), "d MMM yyyy")}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-2">
        <Button size="lg" disabled title="Payment & print — next milestone">
          <Printer />
          Save &amp; Print · F9
        </Button>
        <Button variant="ghost" size="sm" disabled={empty} onClick={clear}>
          Clear bill
        </Button>
      </div>
    </div>
  );
}
