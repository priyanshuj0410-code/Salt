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
import { lineMargin, lineMaxQty, lineNet, lineRate } from "@/lib/billing";
import { cn } from "@/lib/utils";
import type { BillLine } from "@/lib/types";
import { useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";

const cellInput =
  "h-7 w-16 shrink-0 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums focus-visible:border-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function BillTable() {
  const lines = useBill((s) => s.lines);
  const setQty = useBill((s) => s.setQty);
  const setDiscount = useBill((s) => s.setDiscount);
  const setRate = useBill((s) => s.setRate);
  const setLoose = useBill((s) => s.setLoose);
  const removeLine = useBill((s) => s.removeLine);
  const catalog = useCatalog((s) => s.items);
  const [pickerLine, setPickerLine] = useState<BillLine | null>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const batchCount = (itemId: string): number =>
    (catalog.find((c) => c.id === itemId)?.batches ?? []).filter((b) => b.qty > 0).length;

  // Loose-unit sale (SALT-164): a line is divisible only when the item declares >1 base unit
  // per pack. `qty` then means base units (e.g. 4 tablets), so the on-hand cap is packs × upp.
  const uppOf = (l: BillLine): number => (l.unitsPerPack && l.unitsPerPack >= 1 ? l.unitsPerPack : 1);
  const divisible = (l: BillLine): boolean => uppOf(l) > 1;
  const LooseToggle = ({ l }: { l: BillLine }) =>
    divisible(l) ? (
      <button
        type="button"
        onClick={() => setLoose(l.key, !l.loose)}
        aria-pressed={l.loose}
        title={l.loose ? `Selling loose units — ${uppOf(l)} per pack` : "Selling whole packs — tap to sell loose units"}
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
          l.loose
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground hover:text-foreground",
        )}
      >
        {l.loose ? "loose" : "pack"}
      </button>
    ) : null;

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
      <div className="flex min-h-44 flex-1 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-text-tertiary">
        No items yet — search above and press Enter to add.
      </div>
    );
  }

  return (
    <div className="flex flex-col md:min-h-0 md:flex-1">
      {/* Mobile: a card per line — no horizontal scroll, touch-sized controls */}
      <div className="flex flex-col gap-2 md:hidden">
        {lines.map((l) => {
          const margin = lineMargin(l);
          const count = batchCount(l.itemId);
          const cap = lineMaxQty(lines, l);
          return (
            <div key={l.key} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{l.name}</span>
                    <ScheduleBadge schedule={l.schedule} />
                  </div>
                  <div className="truncate text-xs text-text-tertiary">
                    {l.salt} · {l.pack} · GST {l.gstRate}%
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove item"
                  onClick={() => removeLine(l.key)}
                >
                  <Trash2 />
                </Button>
              </div>
              <button
                onClick={() => setPickerLine(l)}
                className="mt-1 inline-flex items-center gap-1 rounded text-xs text-text-tertiary hover:text-text-primary"
              >
                Batch {l.batchNo} · Exp {l.expiry}
                {count > 1 && (
                  <>
                    <ChevronsUpDown className="size-3" />
                    <span className="text-primary">{count} batches</span>
                  </>
                )}
              </button>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-tertiary">Rate</span>
                <div className="flex items-center gap-1.5">
                  {l.ruleLabel && l.ruleLabel !== "MRP" && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                      {l.ruleLabel}
                    </span>
                  )}
                  {lineRate(l) !== l.mrpPaise && (
                    <span className="text-[11px] text-text-tertiary line-through">{formatPaise(l.mrpPaise)}</span>
                  )}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={lineRate(l) / 100}
                    onChange={(e) => setRate(l.key, Math.round((parseFloat(e.target.value) || 0) * 100))}
                    aria-label={`Rate for ${l.name}`}
                    className={cn(cellInput, "w-20")}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-text-tertiary">{l.loose ? "Qty (units)" : "Qty"}</span>
                    <LooseToggle l={l} />
                  </div>
                  <div className="mt-1 flex items-center gap-1">
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
                      max={cap}
                      value={l.qty}
                      onChange={(e) => setQty(l.key, Math.max(1, Number(e.target.value) || 1))}
                      aria-label={`Quantity for ${l.name}`}
                      className={cn(cellInput, "text-center")}
                    />
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Increase quantity"
                      disabled={l.qty >= cap}
                      onClick={() => setQty(l.key, l.qty + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-text-tertiary">Discount</div>
                  <div className="mt-1 flex items-center gap-1">
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
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">{formatPaise(lineNet(l))}</div>
                  <div
                    className={cn(
                      "text-xs tabular-nums",
                      margin < 0 ? "text-destructive" : "text-success",
                    )}
                  >
                    {formatSigned(margin)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: dense keyboard-driven table (the speed benchmark — unchanged) */}
      <div className="hidden overflow-auto rounded-lg border border-border md:block md:min-h-0 md:flex-1">
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-8">#</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="w-28 text-right">Rate</TableHead>
            <TableHead className="w-36 text-center">Qty</TableHead>
            <TableHead className="w-32 text-center">Discount</TableHead>
            <TableHead className="w-32 text-right">Amount</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l, i) => {
            const margin = lineMargin(l);
            const count = batchCount(l.itemId);
            const cap = lineMaxQty(lines, l);
            return (
              <TableRow
                key={l.key}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                tabIndex={0}
                data-bill-row
                onKeyDown={(e) => onRowKey(e, i, l)}
                className="focus-visible:-outline-offset-2 focus-within:bg-primary/5 focus:bg-primary/10"
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
                <TableCell className="align-top">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={lineRate(l) / 100}
                    onChange={(e) => setRate(l.key, Math.round((parseFloat(e.target.value) || 0) * 100))}
                    aria-label={`Rate for ${l.name}`}
                    className={cn(cellInput, "w-20")}
                  />
                  {(lineRate(l) !== l.mrpPaise || (l.ruleLabel && l.ruleLabel !== "MRP")) && (
                    <div className="mt-0.5 text-right text-[11px] text-muted-foreground">
                      {l.ruleLabel && l.ruleLabel !== "MRP" ? `${l.ruleLabel} · ` : ""}
                      MRP {formatPaise(l.mrpPaise)}
                    </div>
                  )}
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
                      max={cap}
                      value={l.qty}
                      onChange={(e) => setQty(l.key, Math.max(1, Number(e.target.value) || 1))}
                      aria-label={`Quantity for ${l.name}`}
                      className={cn(cellInput, "text-center")}
                    />
                    <Button
                      variant="outline"
                      size="icon-xs"
                      aria-label="Increase quantity"
                      disabled={l.qty >= cap}
                      onClick={() => setQty(l.key, l.qty + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>
                      {l.qty >= cap
                        ? "max"
                        : l.loose
                          ? `of ${l.stock * uppOf(l)} u`
                          : `of ${l.stock}`}
                    </span>
                    <LooseToggle l={l} />
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
      </div>

      <BatchPicker line={pickerLine} onOpenChange={(open) => !open && setPickerLine(null)} />
    </div>
  );
}
