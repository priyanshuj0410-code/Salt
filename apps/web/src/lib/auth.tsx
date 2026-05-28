import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type UserRole = "cashier" | "owner";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Start "loading" only when Supabase is configured; otherwise nothing to wait for.
  const [loading, setLoading] = useState(supabase != null);

  // Bootstrap the session and subscribe to auth changes.
  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      // Keep loading while a session's profile is fetched; otherwise we're done.
      setLoading(Boolean(data.session));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) {
        setLoading(true);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the role profile whenever the signed-in user changes.
  useEffect(() => {
    const userId = session?.user.id;
    if (!supabase || !userId) return;
    let active = true;
    supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (!active) return;
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, loading, signOut }}
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
