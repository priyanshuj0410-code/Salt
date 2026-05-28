import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatPaise } from "@/lib/currency";
import { billTotals, useBill } from "@/store/bill";

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}

export function BillSummary() {
  const lines = useBill((s) => s.lines);
  const clear = useBill((s) => s.clear);
  const t = billTotals(lines);
  const empty = lines.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <Row label="Items" value={`${t.items} (${t.qty} qty)`} muted />
      <Separator />
      <Row label="Taxable value" value={formatPaise(t.taxable)} muted />
      <Row label={`CGST`} value={formatPaise(Math.round(t.gst / 2))} muted />
      <Row label={`SGST`} value={formatPaise(t.gst - Math.round(t.gst / 2))} muted />
      <Separator />
      <div className="flex items-baseline justify-between">
        <span className="font-medium">Total payable</span>
        <span className="text-2xl font-semibold tabular-nums">{formatPaise(t.grand)}</span>
      </div>
      <p className="text-center text-xs text-muted-foreground">GST included in MRP</p>

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
