import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSetupProgress } from "./useSetupProgress";

/**
 * Completeness-checklist nudge (SALT-124): a compact, glanceable strip that
 * surfaces remaining first-run steps wherever the owner is (e.g. the owner home),
 * with a progress bar and a link back into the full /setup wizard. It shares
 * useSetupProgress with the wizard, and self-hides once the required steps are done
 * so it never nags a fully set-up shop.
 */
export function SetupChecklist() {
  const { steps, total, doneCount, requiredDone, loading } = useSetupProgress();
  if (loading || requiredDone) return null;

  const remaining = steps.filter((s) => !s.done);
  const pct = Math.round((doneCount / total) * 100);

  return (
    <div className="mb-5 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Finish setting up your shop</h2>
          <p className="text-xs text-muted-foreground">
            {doneCount} of {total} done: {remaining.length} {remaining.length === 1 ? "step" : "steps"} to go.
          </p>
        </div>
        <Link to="/setup" className="shrink-0">
          <Button size="sm">
            Continue setup
            <ArrowRight />
          </Button>
        </Link>
      </div>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {remaining.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="size-3.5 shrink-0" />
              {s.title}
              {s.optional && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">· optional</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
