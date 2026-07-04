import { cn } from "@/lib/utils";
import { ALTITUDE_LABEL, type Altitude } from "@/lib/lens/altitude";

/**
 * The altitude mode-switch — a compact segmented control shown only for
 * multi-altitude users (owner/manager/accountant). Picking a mode brings that
 * altitude's surfaces forward in the sidebar; it changes nothing about access.
 */
export function AltitudeSwitcher({
  held,
  active,
  onChange,
}: {
  held: Altitude[];
  active: Altitude;
  onChange: (a: Altitude) => void;
}) {
  return (
    <div role="tablist" aria-label="Altitude" className="mb-1.5 flex gap-0.5 rounded-lg bg-sidebar-accent/60 p-0.5">
      {held.map((a) => (
        <button
          key={a}
          type="button"
          role="tab"
          aria-selected={a === active}
          onClick={() => onChange(a)}
          className={cn(
            "flex-1 rounded-md px-1.5 py-1 text-xs font-medium transition-colors",
            a === active
              ? "bg-sidebar text-sidebar-foreground shadow-sm"
              : "text-muted-foreground hover:text-sidebar-foreground",
          )}
        >
          {ALTITUDE_LABEL[a]}
        </button>
      ))}
    </div>
  );
}
