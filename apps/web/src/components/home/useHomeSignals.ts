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
export const SIGNAL_ATOMS: ReadonlySet<AtomId> = new Set<AtomId>(["I"]);

const CLEAR: HomeSignal = { value: "Clear", tone: "success" };

interface Signal {
  atom: AtomId;
  /** A cheap head+count query — no rows are fetched, so there is no 1000-row
   *  SELECT cap to under-report against and the count is computed server-side. */
  count: (orgId: string) => Promise<number>;
  toSignal: (n: number) => HomeSignal;
}

/**
 * Only atom I ships as a live tile today. It reads `approval_requests`, which
 * keeps member-level RLS (0030) so every holder (owner, manager) gets a true
 * count. The other page-datum atoms are deliberately NOT here:
 *   - E (GRN "to verify"): `purchases` has no `draft`/unverified state — it is
 *     born `received` (0019); there is no verification workflow to count. Also
 *     owner-only SELECT after 0044.
 *   - K (GST "2B mismatch"): `gstr2b_matches` is owner-only after 0044, so a
 *     manager/accountant (who hold K) would silently read 0 → a false "Clear".
 *     Needs a SECURITY DEFINER RPC + a decision on whether non-owners may see it.
 *   - D (reorder), J (unallocated): need a dedicated stock-on-hand / on-account
 *     view to be cheap and correct.
 * All of the above stay "Open ->" until their backend lands.
 */
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
];

/**
 * Live numbers for the assembled Home's page-datum tiles — one cheap server-side
 * COUNT per HELD signal atom, run in parallel and only for atoms the user holds.
 * Keyed on a primitive string (the held signal-atom letters) so it never
 * re-fetches on unrelated re-renders.
 */
export function useHomeSignals(lens: Lens): { signals: Partial<Record<AtomId, HomeSignal>>; loading: boolean } {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const [signals, setSignals] = useState<Partial<Record<AtomId, HomeSignal>>>({});
  const [loading, setLoading] = useState(true);

  // Which signal atoms this user holds, as a stable-by-value key (e.g. "I").
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
