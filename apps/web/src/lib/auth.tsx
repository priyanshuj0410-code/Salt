import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type UserRole = "cashier" | "owner";

export interface Membership {
  orgId: string;
  orgName: string;
  role: UserRole;
}

/** Primary-shop snapshot used app-wide for place-of-supply, GSTIN, header info. */
export interface Shop {
  id: string;
  name: string;
  state_code: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  cutover_date: string | null;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** The user's org + role, or null if they haven't joined/created an org yet. */
  membership: Membership | null;
  /** The org's primary shop id (kept for back-compat with existing call sites). */
  shopId: string | null;
  /** Full primary-shop record. null until resolved, or if no shop exists yet. */
  shop: Shop | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(supabase != null);
  /** The user id the loading gate is tracking, so we ignore same-user refires. */
  const currentUserId = useRef<string | null>(null);

  const loadMembership = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from("memberships")
      .select("role, org_id, orgs(name)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (data) {
      const org = data.orgs as { name: string } | { name: string }[] | null;
      const orgName = Array.isArray(org) ? (org[0]?.name ?? "") : (org?.name ?? "");
      setMembership({ orgId: data.org_id as string, orgName, role: data.role as UserRole });
      // Resolve the org's working shop. Prefer the one flagged `is_primary`;
      // if none is flagged, fall back to the oldest shop in the org and
      // self-heal by promoting it so subsequent loads are deterministic. This
      // covers orgs whose imports created shops without ever marking one
      // primary (the common case for the four-file Saral import). Tolerates
      // absence (pre-migration or no shop yet): leaves shop null and billing
      // guards on it.
      const { data: shopRow } = await supabase
        .from("shops")
        .select("id, name, state_code, gstin, address, phone, cutover_date, is_primary")
        .eq("org_id", data.org_id as string)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (shopRow) {
        const { is_primary, ...shopFields } = shopRow as Shop & { is_primary: boolean };
        setShop(shopFields);
        setShopId(shopFields.id);
        if (!is_primary) {
          // Self-heal: promote this shop to primary. Errors are swallowed —
          // a unique-per-org race (another tab promoting a different shop)
          // resolves on the next refresh().
          await supabase.from("shops").update({ is_primary: true }).eq("id", shopFields.id);
        }
      } else {
        setShop(null);
        setShopId(null);
      }
    } else {
      setMembership(null);
      setShopId(null);
      setShop(null);
    }
  }, []);

  // Bootstrap the session and subscribe to auth changes.
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      currentUserId.current = data.session?.user.id ?? null;
      setSession(data.session);
      setLoading(Boolean(data.session));
    });

    // Supabase re-fires onAuthStateChange on tab focus / token refresh with the
    // SAME user. Only touch the loading gate when the user actually changes, so
    // refocus doesn't strand the app on a "Loading…" screen.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      const nextId = next?.user.id ?? null;
      if (nextId === currentUserId.current) return; // same user → ignore refire
      currentUserId.current = nextId;
      if (nextId) {
        setLoading(true); // genuine sign-in; the membership effect clears it
      } else {
        setMembership(null);
        setShopId(null);
        setShop(null);
        setLoading(false); // signed out
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load membership whenever the signed-in user changes.
  useEffect(() => {
    const userId = session?.user.id;
    if (!supabase || !userId) return;
    let active = true;
    (async () => {
      await loadMembership(userId);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [session?.user.id, loadMembership]);

  const refresh = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) await loadMembership(userId);
  }, [session?.user.id, loadMembership]);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, membership, shopId, shop, loading, refresh, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
