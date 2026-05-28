import { useRef, useState } from "react";
import { ChevronsUpDown, Minus, Plus, Trash2 } from "lucide-react";
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
import { BatchPicker } from "./BatchPicker";
import { formatPaise, formatSigned } from "@/lib/currency";
import { lineDiscount, lineGross, lineMargin, lineNet } from "@/lib/billing";
import { catalog } from "@/data/catalog";
import { cn } from "@/lib/utils";
import type { BillLine } from "@/lib/types";
import { useBill } from "@/store/bill";

const cellInput =
  "h-7 w-14 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50";

function batchCount(itemId: string): number {
  return (catalog.find((c) => c.id === itemId)?.batches ?? []).filter((b) => b.qty > 0).length;
}

export function BillTable() {
  const lines = useBill((s) => s.lines);
  const setQty = useBill((s) => s.setQty);
  const setDiscount = useBill((s) => s.setDiscount);
  const removeLine = useBill((s) => s.removeLine);
  const [pickerLine, setPickerLine] = useState<BillLine | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  function focusRow(i: number) {
    const clamped = Math.max(0, Math.min(lines.length - 1, i));
    rowRefs.current[clamped]?.focus();
  }

  function onRowKey(e: React.KeyboardEvent<HTMLTableRowElement>, i: number, l: BillLine) {
    // Only act when the row itself is focused, not its inner inputs/buttons.
    if (e.target !== e.currentTarget) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(i + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(i - 1);
        break;
      case "=":
      case "+":
        e.preventDefault();
        setQty(l.key, l.qty + 1);
        break;
      case "-":
        e.preventDefault();
        setQty(l.key, Math.max(1, l.qty - 1));
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        removeLine(l.key);
        focusRow(i);
        break;
    }
  }

  if (lines.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No items yet — search above and press Enter to add.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto rounded-lg border">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="w-24 text-right">MRP</TableHead>
            <TableHead className="w-32 text-center">Qty</TableHead>
            <TableHead className="w-28 text-center">Discount</TableHead>
            <TableHead className="w-32 text-right">Amount</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => {
            const discount = lineDiscount(l);
            const margin = lineMargin(l);
            const count = batchCount(l.itemId);
            return (
              <TableRow
                key={l.key}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                tabIndex={0}
                data-bill-row
                onKeyDown={(e) => onRowKey(e, i, l)}
                className="outline-none focus-within:bg-primary/5 focus:bg-primary/10"
              >
                <TableCell className="align-top text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="align-top">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{l.name}</span>
                    <ScheduleBadge schedule={l.schedule} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.salt} · {l.pack} · GST {l.gstRate}%
                  </div>
                  <button
                    onClick={() => setPickerLine(l)}
                    className="mt-0.5 inline-flex items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground"
                  >
                    Batch {l.batchNo} · Exp {l.expiry}
                    {count > 1 && (
                      <>
                        <ChevronsUpDown className="size-3" />
                        <span className="text-primary">{count} batches</span>
                      </>
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {formatPaise(l.mrpPaise)}
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Decrease quantity"
                      onClick={() => setQty(l.key, l.qty - 1)}
                    >
                      <Minus />
                    </Button>
                    <input
                      type="number"
                      min={1}
                      value={l.qty}
                      onChange={(e) => setQty(l.key, Math.max(1, Number(e.target.value) || 1))}
                      aria-label={`Quantity for ${l.name}`}
                      className={`${cellInput} w-12 text-center`}
                    />
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
                <TableCell className="align-top">
                  <div className="flex items-center justify-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={l.discountType === "pct" ? 100 : undefined}
                      value={l.discountType === "pct" ? l.discountValue : l.discountValue / 100}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        setDiscount(
                          l.key,
                          l.discountType,
                          l.discountType === "pct" ? v : Math.round(v * 100),
                        );
                      }}
                      aria-label={`Discount for ${l.name}`}
                      className={cellInput}
                    />
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Toggle discount type"
                      title={l.discountType === "pct" ? "Percent" : "Flat rupees"}
                      onClick={() =>
                        setDiscount(l.key, l.discountType === "pct" ? "flat" : "pct", 0)
                      }
                    >
                      {l.discountType === "pct" ? "%" : "₹"}
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  <div className="font-medium">{formatPaise(lineNet(l))}</div>
                  <div
                    className={cn(
                      "text-xs text-muted-foreground line-through",
                      discount === 0 && "invisible",
                    )}
                    aria-hidden={discount === 0}
                  >
                    {formatPaise(lineGross(l))}
                  </div>
                  <div
                    className={cn(
                      "text-xs",
                      margin < 0
                        ? "text-destructive"
                        : "text-emerald-600 dark:text-emerald-500",
                    )}
                  >
                    {formatSigned(margin)}
                  </div>
                </TableCell>
                <TableCell className="align-top">
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
            );
          })}
        </TableBody>
      </Table>

      <BatchPicker line={pickerLine} onOpenChange={(open) => !open && setPickerLine(null)} />
    </div>
  );
}
