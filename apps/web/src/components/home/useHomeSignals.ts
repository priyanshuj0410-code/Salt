import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { AtomId } from "@/lib/lens/atoms";
import type { Lens } from "@/lib/lens/deriveLens";

export type SignalTone = "default" | "success" | "danger";
export interface HomeSignal {
  value: string;
  hint?: string;
  tone?: SignalTone;
}

/** Atoms whose Home tile is backed by a live server-side COUNT (this hook). */
export const SIGNAL_ATOMS: ReadonlySet<AtomId> = new Set<AtomId>(["E", "I", "K"]);

const CLEAR: HomeSignal = { value: "Clear", tone: "success" };

interface Signal {
  atom: AtomId;
  /** A cheap head+count query — no rows are fetched, so there is no 1000-row
   *  SELECT cap to under-report against and the count is computed server-side. */
  count: (orgId: string) => Promise<number>;
  toSignal: (n: number) => HomeSignal;
}

const SIGNALS: Signal[] = [
  {
    atom: "I", // Credit & approvals — "needs you"
    count: async (orgId) => {
      const { count } = await supabase!
        .from("approval_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "pending");
      return count ?? 0;
    },
    toSignal: (n) => (n > 0 ? { value: String(n), hint: n === 1 ? "needs you" : "need you", tone: "danger" } : CLEAR),
  },
  {
    atom: "E", // Receive stock (GRN) — "GRNs to verify" (draft = not yet finalized)
    count: async (orgId) => {
      const { count } = await supabase!
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "draft");
      return count ?? 0;
    },
    toSignal: (n) => (n > 0 ? { value: String(n), hint: n === 1 ? "GRN to verify" : "GRNs to verify" } : CLEAR),
  },
  {
    atom: "K", // File GST & compliance — "2B mismatch" (any non-matched reconciliation line)
    count: async (orgId) => {
      const { count } = await supabase!
        .from("gstr2b_matches")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .neq("match_status", "matched");
      return count ?? 0;
    },
    toSignal: (n) => (n > 0 ? { value: String(n), hint: "2B to reconcile", tone: "danger" } : CLEAR),
  },
];

/**
 * Live numbers for the assembled Home's page-datum tiles — one cheap server-side
 * COUNT per HELD signal atom (I approvals, E GRNs-to-verify, K GST 2B), run in
 * parallel and only for atoms the user actually holds. Keyed on a primitive
 * string (the held signal-atom letters) so it never re-fetches on unrelated
 * re-renders. Reorder (D) and unallocated (J) are intentionally absent: a
 * correct+cheap tile for them needs a dedicated SQL view (stock-on-hand vs
 * reorder level; on-account receipts), so they stay "Open ->" until that lands.
 */
export function useHomeSignals(lens: Lens): { signals: Partial<Record<AtomId, HomeSignal>>; loading: boolean } {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const [signals, setSignals] = useState<Partial<Record<AtomId, HomeSignal>>>({});
  const [loading, setLoading] = useState(true);

  // Which signal atoms this user holds, as a stable-by-value key (e.g. "EIK").
  const wantedKey = useMemo(
    () => SIGNALS.filter((s) => lens.heldAtoms.has(s.atom)).map((s) => s.atom).join(""),
    [lens],
  );

  useEffect(() => {
    if (!supabase || !orgId) return;
    let active = true;
    const jobs = SIGNALS.filter((s) => wantedKey.includes(s.atom));
    (async () => {
      if (jobs.length === 0) {
        if (active) {
          setSignals({});
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      const results = await Promise.all(
        jobs.map(async (s) => [s.atom, s.toSignal(await s.count(orgId))] as const),
      );
      if (!active) return;
      const map: Partial<Record<AtomId, HomeSignal>> = {};
      for (const [atom, sig] of results) map[atom] = sig;
      setSignals(map);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [orgId, wantedKey]);

  return { signals, loading };
}
