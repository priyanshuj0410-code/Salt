import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const shortcuts: [string, string][] = [
  ["Type", "Search by name, salt, manufacturer, HSN or barcode"],
  ["↑ / ↓", "Move between search results"],
  ["Enter", "Add the highlighted item at its FEFO batch"],
  ["Esc", "Clear the search box"],
  ["↓", "From an empty search, jump into the bill"],
  ["↑ / ↓", "Move between bill rows (when a row is focused)"],
  ["= / −", "Increase / decrease quantity on the focused row"],
  ["Del", "Remove the focused row"],
  ["Tab", "Move into a row's quantity / discount fields"],
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
