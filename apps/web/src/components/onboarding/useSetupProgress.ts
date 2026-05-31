import { useEffect, useState } from "react";
import { PackagePlus, Printer, Receipt, Store, Upload, UserPlus, type LucideIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/**
 * Shared first-run progress model, consumed by both the full /setup wizard
 * (SALT-122) and the compact completeness checklist nudge (SALT-124) so they can
 * never disagree. Completion is read from live state — shop.state_code plus per-org
 * counts of memberships/invites, items, purchases, sales_invoices — and refreshed
 * on window focus. The printer step has no backend, so it is acknowledged client-side.
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

/** A step plus whether it is currently satisfied. */
export interface SetupStep {
  key: string;
  title: string;
  icon: LucideIcon;
  detail: string;
  optional?: boolean;
  /** Route to the real screen for this step (printer is acknowledged inline instead). */
  to?: string;
  cta: string;
  done: boolean;
}

interface StepDef extends Omit<SetupStep, "done"> {
  isDone: (s: Snapshot, printerOk: boolean) => boolean;
}

const STEPS: StepDef[] = [
  {
    key: "shop",
    title: "Set up your shop",
    icon: Store,
    detail: "Name, GSTIN and state — state decides CGST/SGST vs IGST on every bill.",
    to: "/settings/organisation",
    cta: "Shop details",
    isDone: (s) => s.hasState,
  },
  {
    key: "users",
    title: "Invite your team",
    icon: UserPlus,
    detail: "Generate a code so cashiers can sign in to the counter. You can do this later.",
    optional: true,
    to: "/owner",
    cta: "Invite a cashier",
    isDone: (s) => s.members > 1 || s.invites > 0,
  },
  {
    key: "printer",
    title: "Ready your printer",
    icon: Printer,
    detail: "Bills print through your browser (Ctrl+P). Print a test once your printer is connected.",
    optional: true,
    cta: "Mark printer ready",
    isDone: (_s, printerOk) => printerOk,
  },
  {
    key: "import",
    title: "Import your catalogue",
    icon: Upload,
    detail: "Bring items and stock in from Marg/Tally, or a simple CSV — Smart Import auto-maps columns.",
    to: "/import",
    cta: "Import catalogue",
    isDone: (s) => s.items > 0,
  },
  {
    key: "grn",
    title: "Receive your first stock",
    icon: PackagePlus,
    detail: "Record a goods receipt (GRN) from a distributor — this is how stock and payables start.",
    to: "/purchases/new",
    cta: "New GRN",
    isDone: (s) => s.purchases > 0,
  },
  {
    key: "sale",
    title: "Make your first sale",
    icon: Receipt,
    detail: "Ring up a bill at the counter. Once you save one, you are live.",
    to: "/",
    cta: "Go to counter",
    isDone: (s) => s.sales > 0,
  },
];

export interface SetupProgress {
  steps: SetupStep[];
  total: number;
  doneCount: number;
  /** True when every non-optional step is satisfied — the "ready to run" state. */
  requiredDone: boolean;
  loading: boolean;
  markPrinterReady: () => void;
}

export function useSetupProgress(): SetupProgress {
  const { membership, shop } = useAuth();
  const orgId = membership?.orgId;
  const stateCode = shop?.state_code ?? null;
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [printerOk, setPrinterOk] = useState(() => readPrinterDone(orgId));
  const [loading, setLoading] = useState(true);

  // Refresh on mount and on window focus (owner returning from a step screen).
  // setState lives only in the async .then callback, never synchronously here.
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

  const steps: SetupStep[] = STEPS.map(({ isDone, ...meta }) => ({ ...meta, done: isDone(snap, printerOk) }));
  const doneCount = steps.filter((s) => s.done).length;
  const requiredDone = STEPS.every((s) => s.optional || s.isDone(snap, printerOk));

  function markPrinterReady() {
    if (!orgId) return;
    localStorage.setItem(printerKey(orgId), "done");
    setPrinterOk(true);
  }

  return { steps, total: steps.length, doneCount, requiredDone, loading, markPrinterReady };
}
