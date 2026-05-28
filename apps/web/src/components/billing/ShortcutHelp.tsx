import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const shortcuts: [string, string][] = [
  ["Type", "Search items by name, salt, manufacturer, HSN or barcode"],
  ["↑ / ↓", "Move between search results"],
  ["Enter", "Add the highlighted item (qty 1) at its FEFO batch"],
  ["Esc", "Clear the search box"],
  ["Tab", "Move into a line's quantity / discount fields"],
  ["Type", "Edit quantity or discount directly once focused"],
  ["+ / −", "Adjust quantity on a bill line"],
  ["Batch", "Click the batch line to switch batch / see purchase price"],
  ["?", "Open this shortcut reference"],
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
          <DialogDescription>
            The billing counter is fully keyboard-driven.
          </DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2">
          {shortcuts.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3 text-sm">
              <kbd className="min-w-16 rounded border bg-muted px-2 py-0.5 text-center font-mono text-xs">
                {key}
              </kbd>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
