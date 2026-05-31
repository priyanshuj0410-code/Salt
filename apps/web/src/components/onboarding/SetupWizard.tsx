import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  PackagePlus,
  Printer,
  Receipt,
  Store,
  Upload,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/patterns/page";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * First-run setup wizard (SALT-122): shop → users → printer → import → GRN → sale.
 *
 * Owners land here straight after creating their org. It does not re-implement any
 * of those screens — each step links to the real one and tracks completion by
 * reading live state (shop.state_code, and per-org counts of memberships/invites,
 * items, purchases, sales_invoices). Returning from a step refreshes on window focus,
 * so the checklist fills in as the owner works. The printer step has no backend yet,
 * so it is acknowledged client-side (localStorage, per org).
 */

interface Snapshot {
  hasState: boolean;
  members: number;
  invites: number;
  items: number;
  purchases: number;
  sales: number;
}

const EMPTY: Snapshot = { hasState: false, members: 0, invites: 0, items: 0, purchases: 0, sales: 0 };

const printerKey = (orgId: string) => `salt.setup.printer.${orgId}`;
function readPrinterDone(orgId: string | undefined): boolean {
  if (!orgId || typeof localStorage === "undefined") return false;
  return localStorage.getItem(printerKey(orgId)) === "done";
}

async function countRows(table: string, orgId: string): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true }).eq("org_id", orgId);
  return count ?? 0;
}

async function fetchSnapshot(orgId: string, hasState: boolean): Promise<Snapshot> {
  const [members, invites, items, purchases, sales] = await Promise.all([
    countRows("memberships", orgId),
    countRows("invites", orgId),
    countRows("items", orgId),
    countRows("purchases", orgId),
    countRows("sales_invoices", orgId),
  ]);
  return { hasState, members, invites, items, purchases, sales };
}

interface Step {
  key: string;
  title: string;
  icon: typeof Store;
  detail: string;
  done: (s: Snapshot) => boolean;
  optional?: boolean;
  /** Route to the real screen for this step (printer is handled inline instead). */
  to?: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    key: "shop",
    title: "Set up your shop",
    icon: Store,
    detail: "Name, GSTIN and state — state decides CGST/SGST vs IGST on every bill.",
    done: (s) => s.hasState,
    to: "/settings/organisation",
    cta: "Shop details",
  },
  {
    key: "users",
    title: "Invite your team",
    icon: UserPlus,
    detail: "Generate a code so cashiers can sign in to the counter. You can do this later.",
    done: (s) => s.members > 1 || s.invites > 0,
    optional: true,
    to: "/owner",
    cta: "Invite a cashier",
  },
  {
    key: "printer",
    title: "Ready your printer",
    icon: Printer,
    detail: "Bills print through your browser (Ctrl+P). Print a test once your printer is connected.",
    done: () => false, // overridden per-org below
    optional: true,
    cta: "Mark printer ready",
  },
  {
    key: "import",
    title: "Import your catalogue",
    icon: Upload,
    detail: "Bring items and stock in from Marg/Tally, or a simple CSV — Smart Import auto-maps columns.",
    done: (s) => s.items > 0,
    to: "/import",
    cta: "Import catalogue",
  },
  {
    key: "grn",
    title: "Receive your first stock",
    icon: PackagePlus,
    detail: "Record a goods receipt (GRN) from a distributor — this is how stock and payables start.",
    done: (s) => s.purchases > 0,
    to: "/purchases/new",
    cta: "New GRN",
  },
  {
    key: "sale",
    title: "Make your first sale",
    icon: Receipt,
    detail: "Ring up a bill at the counter. Once you save one, you are live.",
    done: (s) => s.sales > 0,
    to: "/",
    cta: "Go to counter",
  },
];

export function SetupWizard() {
  const { membership, shop } = useAuth();
  const orgId = membership?.orgId;
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [printerOk, setPrinterOk] = useState(() => readPrinterDone(orgId));
  const [loading, setLoading] = useState(true);

  const stateCode = shop?.state_code ?? null;

  // Refresh on mount and whenever the tab regains focus (the owner returning from
  // a step screen) — the checklist fills in without manual reloads. setState lives
  // only in the async .then callback, never synchronously in the effect body.
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    const run = () =>
      fetchSnapshot(orgId, Boolean(stateCode)).then((s) => {
        if (!active) return;
        setSnap(s);
        setPrinterOk(readPrinterDone(orgId));
        setLoading(false);
      });
    run();
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [orgId, stateCode]);

  function isDone(step: Step): boolean {
    if (step.key === "printer") return printerOk;
    return step.done(snap);
  }

  function markPrinterReady() {
    if (!orgId) return;
    localStorage.setItem(printerKey(orgId), "done");
    setPrinterOk(true);
  }

  const requiredDone = STEPS.filter((s) => !s.optional).every(isDone);
  const doneCount = STEPS.filter(isDone).length;
  // The first not-yet-done step is the "current" one — gets the primary CTA + ring.
  const currentKey = useMemo(() => STEPS.find((s) => !isDone(s))?.key, [snap, printerOk]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page width="sm">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Get your shop running</h1>
        <span className="text-sm tabular-nums text-muted-foreground">{doneCount} / {STEPS.length} done</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        A few steps to go from empty to your first bill. Do them in any order — this list keeps itself up to date.
      </p>

      {requiredDone && (
        <div className="mt-5 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <Check className="size-5" />
            </span>
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">You are ready to run your shop.</p>
              <p className="text-xs text-muted-foreground">The optional steps can wait — jump into billing whenever you like.</p>
            </div>
          </div>
          <Link to="/" className="shrink-0">
            <Button>Go to billing</Button>
          </Link>
        </div>
      )}

      <ol className="mt-5 space-y-3">
        {STEPS.map((step, i) => {
          const done = isDone(step);
          const current = step.key === currentKey;
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={`flex items-start gap-3 rounded-lg border p-4 ${
                current ? "border-primary/50 ring-1 ring-primary/30" : done ? "bg-muted/30" : ""
              }`}
            >
              <span
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                  done
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : current
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <h2 className={`text-sm font-medium ${done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>
                    {step.title}
                  </h2>
                  {step.optional && !done && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      optional
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
              </div>
              <div className="shrink-0 self-center">
                {done ? (
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
