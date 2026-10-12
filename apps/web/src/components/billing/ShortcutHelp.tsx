import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  SHORTCUT_LABELS,
  SHORTCUT_ORDER,
  formatKey,
  keyFromEvent,
  useKeymap,
  type ShortcutAction,
} from "@/store/shortcuts";

/** Fixed, input-level navigation — not rebindable (these are part of the search / row UX). */
const staticGroups: { title: string; items: [string, string][] }[] = [
  {
    title: "Search",
    items: [
      ["Type", "Filter the catalogue by name, salt, manufacturer, HSN or barcode"],
      ["↑ / ↓", "Move between search results"],
      ["Enter", "Add the highlighted item (FEFO batch), or its best substitute if out of stock"],
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
];

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const keymap = useKeymap((s) => s.keymap);
  const rebind = useKeymap((s) => s.rebind);
  const reset = useKeymap((s) => s.reset);
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [clash, setClash] = useState<string | null>(null);

  // While capturing, intercept the keystroke in the capture phase and stop it — so rebinding
  // (e.g. to F9) does not also fire the live global hotkey it is being bound to.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setEditing(null);
        setClash(null);
        return;
      }
      const key = keyFromEvent(e);
      if (!key) return; // bare modifier: keep listening for the real key
      e.preventDefault();
      e.stopPropagation();
      const conflict = rebind(editing, key);
      setClash(conflict ? `${formatKey(key)} is already “${SHORTCUT_LABELS[conflict]}”.` : null);
      setEditing(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [editing, rebind]);

  function close(o: boolean) {
    if (!o) {
      setEditing(null);
      setClash(null);
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>The billing counter is fully keyboard-driven.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
                Actions: click a key to rebind
              </p>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  reset();
                  setEditing(null);
                  setClash(null);
                }}
              >
                Reset
              </Button>
            </div>
            <dl className="flex flex-col gap-1.5">
              {SHORTCUT_ORDER.map((a) => (
                <div key={a} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{SHORTCUT_LABELS[a]}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(a);
                      setClash(null);
                    }}
                    className={
                      editing === a
                        ? "min-w-24 rounded border border-ring bg-primary/10 px-2 py-0.5 text-center font-mono text-xs"
                        : "min-w-24 rounded border bg-muted px-2 py-0.5 text-center font-mono text-xs hover:border-ring"
                    }
                  >
                    {editing === a ? "Press a key…" : formatKey(keymap[a])}
                  </button>
                </div>
              ))}
            </dl>
            {clash && <p className="mt-1 text-xs text-destructive">{clash}</p>}
            {editing && <p className="mt-1 text-xs text-text-tertiary">Press a key (Esc to cancel).</p>}
          </div>

          {staticGroups.map((g) => (
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
