import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Lock } from "lucide-react";
import { UserMenu } from "@/components/auth/UserMenu";
import { useAuth } from "@/lib/auth";
import { ENTITIES, type EntityConfig } from "@/lib/smartImport";
import { DOCUMENTS, type DocumentConfig } from "@/lib/smartDocument";
import { PAYMENT_CONFIG } from "@/lib/smartPayment";
import { cn } from "@/lib/utils";
import { EntityStep } from "./EntityStep";
import { LedgerStep } from "./LedgerStep";
import { PartyGstStep } from "./PartyGstStep";
import { DocumentStep } from "./DocumentStep";
import { PaymentStep } from "./PaymentStep";
import { OpeningStockStep } from "./OpeningStockStep";
import { DropAllPanel } from "./DropAllPanel";
import { Gstr2bStep } from "./Gstr2bStep";

type Step =
  | { kind: "entity"; key: string; label: string; entity: EntityConfig }
  | { kind: "doc"; key: string; label: string; doc: DocumentConfig }
  | { kind: "payment"; key: string; label: string }
  | { kind: "opening"; key: string; label: string }
  | { kind: "gstr2b"; key: string; label: string };

const STEPS: Step[] = [
  // Opening-stock reconciliation slots in right after batches & stock.
  ...ENTITIES.flatMap((e): Step[] =>
    e.key === "batches"
      ? [
          { kind: "entity", key: e.key, label: e.label, entity: e },
          { kind: "opening", key: "opening_stock", label: "Opening stock" },
        ]
      : [{ kind: "entity", key: e.key, label: e.label, entity: e }],
  ),
  ...DOCUMENTS.map((d): Step => ({ kind: "doc", key: d.key, label: d.label, doc: d })),
  { kind: "payment", key: PAYMENT_CONFIG.key, label: PAYMENT_CONFIG.label },
  { kind: "gstr2b", key: "gstr2b", label: "GSTR-2B" },
];

export function SmartImportPage() {
  const auth = useAuth();
  const orgId = auth.membership?.orgId;
  const shopId = auth.shopId;
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  // A file routed in from the drop-all panel: jump to its step, pre-loaded.
  const [routed, setRouted] = useState<{ key: string; file: File } | null>(null);

  const allDone = completed.size === STEPS.length;

  const routeFile = (stepKey: string, file: File) => {
    const idx = STEPS.findIndex((s) => s.key === stepKey);
    if (idx < 0) return;
    setRouted({ key: stepKey, file });
    setActive(idx);
  };

  function renderStep(step: Step, advance: () => void) {
    const initialFile = routed?.key === step.key ? routed.file : null;
    if (step.kind === "doc") {
      return <DocumentStep key={step.key} cfg={step.doc} orgId={orgId} shopId={shopId} initialFile={initialFile} onComplete={advance} />;
    }
    if (step.kind === "payment") {
      return <PaymentStep key={step.key} orgId={orgId} shopId={shopId} initialFile={initialFile} onComplete={advance} />;
    }
    if (step.kind === "opening") {
      return <OpeningStockStep key={step.key} orgId={orgId} shopId={shopId} onComplete={advance} />;
    }
    if (step.kind === "gstr2b") {
      return <Gstr2bStep key={step.key} orgId={orgId} onComplete={advance} />;
    }
    if (step.key === "ledgers") return <LedgerStep key="ledgers" orgId={orgId} onComplete={advance} />;
    if (step.key === "party_gstin") return <PartyGstStep key="party_gstin" orgId={orgId} onComplete={advance} />;
    return <EntityStep key={step.key} entity={step.entity} orgId={orgId} shopId={shopId} initialFile={initialFile} onComplete={advance} />;
  }

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
          need a fix. Import in order: parties, catalogue, stock, then history.
        </p>

        {/* Drop-all auto-detect router (SALT-153) */}
        <div className="mt-5">
          <DropAllPanel onRoute={routeFile} />
        </div>

        {/* Cascade stepper */}
        <ol className="mt-5 flex flex-wrap items-center gap-2">
          {STEPS.map((step, i) => {
            const done = completed.has(step.key);
            const locked = i > active && !done;
            return (
              <li key={step.key} className="flex flex-1 items-center gap-2">
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
                  <span className="font-medium">{step.label}</span>
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
            (() => {
              const advance = () => {
                setCompleted((prev) => new Set(prev).add(STEPS[active].key));
                setActive((i) => Math.min(STEPS.length - 1, i + 1));
                setRouted(null);
              };
              return renderStep(STEPS[active], advance);
            })()
          )}
        </div>

        <Link to="/import" className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground">
          ← Back to import options
        </Link>
      </main>
    </div>
  );
}
