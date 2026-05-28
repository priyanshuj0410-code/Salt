import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScheduleBadge } from "./ScheduleBadge";
import { formatPaise } from "@/lib/currency";
import { useBill } from "@/store/bill";

export function BillTable() {
  const lines = useBill((s) => s.lines);
  const setQty = useBill((s) => s.setQty);
  const removeLine = useBill((s) => s.removeLine);

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No items yet — search above and press Enter to add.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">MRP</TableHead>
            <TableHead className="text-center">Qty</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => (
            <TableRow key={l.key}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{l.name}</span>
                  <ScheduleBadge schedule={l.schedule} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.salt} · {l.pack}
                </div>
                <div className="text-xs text-muted-foreground">
                  Batch {l.batchNo} · Exp {l.expiry} · GST {l.gstRate}%
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPaise(l.mrpPaise)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(l.key, l.qty - 1)}
                  >
                    <Minus />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{l.qty}</span>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label="Increase quantity"
                    onClick={() => setQty(l.key, l.qty + 1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatPaise(l.mrpPaise * l.qty)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove item"
                  onClick={() => removeLine(l.key)}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
