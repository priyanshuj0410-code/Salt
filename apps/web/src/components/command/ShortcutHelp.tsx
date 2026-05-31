import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useUI } from "@/store/ui";
import { useAuth } from "@/lib/auth";
import { helpGroups } from "@/lib/shortcuts";

/** The `?` keyboard-help overlay — data-driven from the shortcut registry, so it
 *  can never drift from the handlers. design.md: no tooltip-only shortcuts. */
export function ShortcutHelp() {
  const open = useUI((s) => s.helpOpen);
  const setOpen = useUI((s) => s.setHelpOpen);
  const role = useAuth().membership?.role;
  const groups = helpGroups(role);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[0.6875rem] font-semibold tracking-wide text-text-tertiary uppercase">
                {g.title}
              </div>
              <div className="space-y-1.5">
                {g.rows.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-text-secondary">{r.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {r.keys.map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
