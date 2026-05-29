import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { addDays, format } from "date-fns";
import { Banknote, CalendarClock, Check, Printer, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatPaise, formatSigned } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { buildSalePayload } from "@/lib/orders";
import { billTotals, useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";

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
  const party = useBill((s) => s.party);
  const setPaymentMethod = useBill((s) => s.setPaymentMethod);
  const setCreditDays = useBill((s) => s.setCreditDays);
  const usingSeed = useCatalog((s) => s.usingSeed);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = billTotals(lines);
  const empty = lines.length === 0;
  const marginPct = t.grand > 0 ? Math.round((t.margin / t.grand) * 100) : 0;
  const loss = t.margin < 0;

  async function save() {
    if (!supabase || empty || usingSeed) return;
    setSaving(true);
    setError(null);
    try {
      const args = buildSalePayload(party, lines, payment);
      const { error: err } = await supabase.rpc("place_order", args);
      if (err) {
        setError(err.message);
        return;
      }
      clear();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  useHotkeys(
    "f9",
    (e) => {
      e.preventDefault();
      void save();
    },
    { enableOnFormTags: true },
    [lines, payment, party, usingSeed],
  );

  return (
    <div className="flex flex-col gap-3 overflow-auto rounded-lg border p-4">
      <Row label="Gross (MRP)" value={formatPaise(t.gross)} muted />
      <Row
        label="Discount"
        value={t.discount > 0 ? `− ${formatPaise(t.discount)}` : formatPaise(0)}
        muted
      />
      <Row label="Taxable value" value={formatPaise(t.taxable)} muted />
      <Row label="CGST" value={formatPaise(Math.round(t.gst / 2))} muted />
      <Row label="SGST" value={formatPaise(t.gst - Math.round(t.gst / 2))} muted />
      <Separator />
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Total payable</span>
        <span className="text-2xl font-semibold tabular-nums">{formatPaise(t.grand)}</span>
      </div>

      <div
        className={cn(
          "flex items-center justify-between rounded-md px-3 py-2",
          loss
            ? "bg-destructive/10 text-destructive"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        )}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {loss ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
          {loss ? "Est. loss" : "Est. earnings"}
        </span>
        <span className="text-right">
          <span className="font-semibold tabular-nums">{formatSigned(t.margin)}</span>
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
        <Button
          size="lg"
          disabled={empty || saving || usingSeed}
          onClick={save}
          title={usingSeed ? "Import your items to save bills" : undefined}
        >
          {saved ? <Check /> : <Printer />}
          {saved ? "Saved" : saving ? "Saving…" : "Save bill · F9"}
        </Button>
        {usingSeed && (
          <p className="text-center text-xs text-muted-foreground">
            Demo catalogue — import your items to save bills.
          </p>
        )}
        {error && <p className="text-center text-xs text-destructive">{error}</p>}
        <Button variant="ghost" size="sm" disabled={empty} onClick={clear}>
          Clear bill
        </Button>
      </div>
    </div>
  );
}
