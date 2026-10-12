import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useUI } from "@/store/ui";
import { useAuth } from "@/lib/auth";
import { paletteItems } from "@/lib/shortcuts";
import { visibleSurfaces } from "@/components/nav/surfaceNav";
import { LENS_V2 } from "@/lib/flags";
import { useLens } from "@/lib/lens/useLens";

/** Ctrl/Cmd+K command palette — jump to any screen (and, later, party/item).
 *  cmdk supplies fuzzy filter + arrow/enter navigation inside our Dialog. */
export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const role = useAuth().membership?.role;
  const lens = useLens();
  const items = paletteItems(role, LENS_V2 ? visibleSurfaces(lens) : undefined);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          label="Command palette"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-text-tertiary [&_[cmdk-group-heading]]:uppercase"
        >
          <Command.Input
            autoFocus
            placeholder="Search screens and actions…"
            className="w-full border-b border-border bg-transparent px-4 py-3 text-base focus-visible:-outline-offset-2 placeholder:text-text-tertiary"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-sm text-text-tertiary">No matches.</Command.Empty>
            <Command.Group heading="Go to">
              {items.map((it) => (
                <Command.Item
                  key={it.path + it.label}
                  value={`${it.label} ${it.hint ?? ""}`}
                  onSelect={() => go(it.path)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-text-secondary data-[selected=true]:bg-surface-2 data-[selected=true]:text-text-primary"
                >
                  <span className="flex-1 truncate">
                    {it.label}
                    {it.hint && <span className="ml-1.5 text-text-tertiary">· {it.hint}</span>}
                  </span>
                  {it.keys && (
                    <span className="flex gap-1">
                      {it.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
