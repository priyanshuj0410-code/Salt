import { Check } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPaise } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { BillLine } from "@/lib/types";
import { useBill } from "@/store/bill";
import { useCatalog } from "@/store/catalog";

export function BatchPicker({
  line,
  onOpenChange,
}: {
  line: BillLine | null;
  onOpenChange: (open: boolean) => void;
}) {
  const setBatch = useBill((s) => s.setBatch);
  const catalog = useCatalog((s) => s.items);
  const item = line ? catalog.find((c) => c.id === line.itemId) : undefined;
  const batches = (item?.batches ?? []).filter((b) => b.qty > 0);

  return (
    <Sheet open={!!line} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{item?.name}: select batch</SheetTitle>
          <SheetDescription>
            {item?.salt} · {item?.pack}
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_3rem_5.5rem_5.5rem_5.5rem] gap-x-4 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>Batch / Expiry</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Purchase</span>
            <span className="text-right">MRP</span>
            <span className="text-right">Margin</span>
          </div>
          {batches.map((b) => {
            const selected = b.batchNo === line?.batchNo;
            return (
              <button
                key={b.batchNo}
                onClick={() => {
                  if (line && item) setBatch(line.key, item, b);
                  onOpenChange(false);
                }}
                className={cn(
                  "grid w-full grid-cols-[1fr_3rem_5.5rem_5.5rem_5.5rem] items-center gap-x-4 px-3 py-2 text-left text-sm hover:bg-muted",
                  selected && "bg-muted",
                )}
              >
                <span className="flex items-center gap-2">
                  {selected ? (
                    <Check className="size-3.5 text-primary" />
                  ) : (
                    <span className="size-3.5" />
                  )}
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{b.batchNo}</span>
                    <span className="text-xs text-muted-foreground">Exp {b.expiry}</span>
                  </span>
                </span>
                <span className="text-right tabular-nums text-muted-foreground">{b.qty}</span>
                <span className="text-right tabular-nums text-muted-foreground">{formatPaise(b.ptrPaise)}</span>
                <span className="text-right tabular-nums">{formatPaise(b.mrpPaise)}</span>
                <span className="text-right tabular-nums text-emerald-600 dark:text-emerald-500">
                  {formatPaise(b.mrpPaise - b.ptrPaise)}
                </span>
              </button>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
