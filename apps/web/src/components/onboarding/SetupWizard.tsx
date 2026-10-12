import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { useSetupProgress } from "./useSetupProgress";

/**
 * First-run setup wizard (SALT-122): shop → users → printer → import → GRN → sale.
 *
 * It does not re-implement any of those screens — each step links to the real one
 * and tracks completion from live state via useSetupProgress (shared with the
 * SetupChecklist nudge). Returning from a step refreshes on window focus, so the
 * checklist fills in as the owner works.
 */
export function SetupWizard() {
  const { steps, total, doneCount, requiredDone, loading, markPrinterReady } = useSetupProgress();
  // The first not-yet-done step is the "current" one — gets the primary CTA + ring.
  const currentKey = steps.find((s) => !s.done)?.key;

  return (
    <Page width="sm">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Get your shop running</h1>
        <span className="text-sm tabular-nums text-muted-foreground">{doneCount} / {total} done</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        A few steps to go from empty to your first bill. Do them in any order. This list keeps itself up to date.
      </p>

      {requiredDone && (
        <div className="mt-5 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Check className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">You are ready to run your shop.</p>
              <p className="text-xs text-muted-foreground">The optional steps can wait, jump into billing whenever you like.</p>
            </div>
          </div>
          <Link to="/" className="shrink-0">
            <Button>Go to billing</Button>
          </Link>
        </div>
      )}

      <ol className="mt-5 space-y-3">
        {steps.map((step, i) => {
          const current = step.key === currentKey;
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={`flex items-start gap-3 rounded-lg border p-4 ${
                current ? "border-primary/50 ring-1 ring-primary/30" : step.done ? "bg-muted/30" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  step.done
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : current
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                aria-hidden
              >
                {step.done ? <Check className="size-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <h2 className={`text-sm font-medium ${step.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>
                    {step.title}
                  </h2>
                  {step.optional && !step.done && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      optional
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
              </div>
              <div className="shrink-0 self-center">
                {step.done ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Done</span>
                ) : step.key === "printer" ? (
                  <Button variant={current ? "default" : "outline"} size="sm" onClick={markPrinterReady}>
                    {step.cta}
                  </Button>
                ) : (
                  <Link to={step.to ?? "/"}>
                    <Button variant={current ? "default" : "outline"} size="sm">
                      {step.cta}
                      <ArrowRight />
                    </Button>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm">
        <Link to="/" className="font-medium text-muted-foreground hover:text-foreground">
          Skip for now
        </Link>
        {loading && <span className="text-xs text-muted-foreground">Checking your progress…</span>}
      </div>
    </Page>
  );
}
