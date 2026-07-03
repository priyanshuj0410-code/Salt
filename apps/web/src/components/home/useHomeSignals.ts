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

/** Atoms whose Home tile is backed by a live server-side number (this hook). */
export const SIGNAL_ATOMS: ReadonlySet<AtomId> = new Set<AtomId>(["D", "I"]);

const CLEAR: HomeSignal = { value: "Clear", tone: "success" };

interface Signal {
  atom: AtomId;
  /** Resolve the tile's number for an org. Cheap: a head+count or a single
   *  aggregate row — no bulk rows, so no 1000-row SELECT cap to under-report. */
  count: (orgId: string) => Promise<number>;
  toSignal: (n: number) => HomeSignal;
}

/**
 * Live signal atoms. Only the ones with a correct + cheap + member-readable
 * source ship:
 *   - I (approvals): `approval_requests` keeps member-level RLS (0030).
 *   - D (reorder): reads `v_reorder_count` (0063) — inventory is is_member (0004),
 *     untouched by 0044. Requires migration 0063 to be applied; until then the
 *     query errors and the tile degrades to "Clear".
 * Deliberately NOT here:
 *   - E (GRN "to verify"): `purchases` has no draft/unverified state (born
 *     `received`, 0019) and is owner-only after 0044.
 *   - K (GST "2B"): `gstr2b_matches` is owner-only after 0044, so managers /
 *     accountants (who hold K) would silently read 0. Needs a SECURITY DEFINER
 *     RPC + an access decision.
 *   - J (unallocated): financial, same owner-only RLS wall as K.
 * All of the above stay "Open ->" until their backend lands.
 */
const SIGNALS: Signal[] = [
  {
    atom: "D", // Order stock — "reorder / low"
    count: async (orgId) => {
      const { data } = await supabase!
        .from("v_reorder_count")
        .select("reorder_count")
        .eq("org_id", orgId)
        .maybeSingle();
      return (data as { reorder_count: number } | null)?.reorder_count ?? 0;
    },
    toSignal: (n) => (n > 0 ? { value: String(n), hint: n === 1 ? "item to reorder" : "items to reorder", tone: "danger" } : CLEAR),
  },
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
 * Live numbers for the assembled Home's page-datum tiles — one cheap query per
 * HELD signal atom, run in parallel and only for atoms the user holds. Keyed on
 * a primitive string (the held signal-atom letters) so it never re-fetches on
 * unrelated re-renders.
 */
export function useHomeSignals(lens: Lens): { signals: Partial<Record<AtomId, HomeSignal>>; loading: boolean } {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const [signals, setSignals] = useState<Partial<Record<AtomId, HomeSignal>>>({});
  const [loading, setLoading] = useState(true);

  // Which signal atoms this user holds, as a stable-by-value key (e.g. "DI").
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
