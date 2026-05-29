import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Lock } from "lucide-react";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { ENTITIES, type EntityKey } from "@/lib/smartImport";
import { cn } from "@/lib/utils";
import { EntityStep } from "./EntityStep";

export function SmartImportPage() {
  const orgId = useAuth().membership?.orgId;
  const [completed, setCompleted] = useState<Set<EntityKey>>(new Set());
  const [active, setActive] = useState(0);

  const allDone = completed.size === ENTITIES.length;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-semibold tracking-tight">Salt</span>
          <span className="text-xs text-muted-foreground">Smart import</span>
        </div>
        <UserMenu />
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <h1 className="text-xl font-semibold">Smart import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop your Marg/Tally export — we auto-map the columns and quarantine only the rows that
          need a fix. Import in order: ledgers, then items, then stock.
        </p>

        {/* Cascade stepper */}
        <ol className="mt-5 flex items-center gap-2">
          {ENTITIES.map((e, i) => {
            const done = completed.has(e.key);
            const locked = i > active && !done;
            return (
              <li key={e.key} className="flex flex-1 items-center gap-2">
                <button
                  disabled={locked}
                  onClick={() => !locked && setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                    i === active && "border-primary bg-primary/5",
                    locked && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-xs",
                      done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-3" /> : locked ? <Lock className="size-3" /> : i + 1}
                  </span>
                  <span className="font-medium">{e.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-5">
          {allDone ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">All steps complete.</p>
              <Link to="/" className="mt-1 inline-block font-medium text-primary hover:underline">
                Go to billing →
              </Link>
            </div>
          ) : (
            <EntityStep
              key={ENTITIES[active].key}
              entity={ENTITIES[active]}
              orgId={orgId}
              onComplete={() => {
                setCompleted((prev) => new Set(prev).add(ENTITIES[active].key));
                setActive((i) => Math.min(ENTITIES.length - 1, i + 1));
              }}
            />
          )}
        </div>

        <Link to="/import" className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Back to import options
        </Link>
      </main>
    </div>
  );
}
