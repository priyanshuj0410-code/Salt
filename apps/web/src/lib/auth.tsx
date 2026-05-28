import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** The user's org + role, or null if they haven't joined/created an org yet. */
  membership: Membership | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(supabase != null);

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
    } else {
      setMembership(null);
    }
  }, []);

  // Bootstrap the session and subscribe to auth changes.
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(Boolean(data.session));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) {
        setLoading(true);
      } else {
        setMembership(null);
        setLoading(false);
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
      value={{ session, user: session?.user ?? null, membership, loading, refresh, signOut }}
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
