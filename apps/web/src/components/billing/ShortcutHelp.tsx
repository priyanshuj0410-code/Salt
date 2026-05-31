import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The complete counter keyboard map, grouped — mirrors the bindings in
 *  `BillingScreen` / `ItemSearch` / `BillTable` / `useCheckout`. */
const groups: { title: string; items: [string, string][] }[] = [
  {
    title: "Search",
    items: [
      ["Type", "Filter the catalogue by name, salt, manufacturer, HSN or barcode"],
      ["↑ / ↓", "Move between search results"],
      ["Enter", "Add the highlighted item (FEFO batch) — or its best substitute if out of stock"],
      ["Esc", "Clear the search box"],
      ["↓", "From an empty search box, jump into the bill"],
    ],
  },
  {
    title: "Bill rows",
    items: [
      ["↑ / ↓", "Move between bill rows"],
      ["= / +", "Increase quantity by 1"],
      ["−", "Decrease quantity by 1"],
      ["Del / ⌫", "Remove the focused row"],
      ["Tab", "Move into the row's quantity / discount fields"],
    ],
  },
  {
    title: "Customer & holds",
    items: [
      ["Ctrl + K", "Change customer (type, then Enter picks the top match)"],
      ["F4", "Hold the current bill aside and start a fresh one"],
    ],
  },
  {
    title: "Checkout",
    items: [
      ["F9", "Save & Print the bill"],
      ["?", "Open this shortcut reference (Shift + /)"],
    ],
  },
];

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>The billing counter is fully keyboard-driven.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                {g.title}
              </p>
              <dl className="flex flex-col gap-1.5">
                {g.items.map(([key, desc]) => (
                  <div key={key + desc} className="flex items-center gap-3 text-sm">
                    <kbd className="min-w-20 shrink-0 rounded border bg-muted px-2 py-0.5 text-center font-mono text-xs">
                      {key}
                    </kbd>
                    <span className="text-muted-foreground">{desc}</span>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
