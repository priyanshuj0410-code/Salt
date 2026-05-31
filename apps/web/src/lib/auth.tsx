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
import { IdleWarningDialog } from "@/components/auth/IdleWarningDialog";
import { UpdatePasswordDialog } from "@/components/auth/UpdatePasswordDialog";

/**
 * Idle auto-logout (SALT-115). Shared pharmacy-counter terminals must not leave
 * an unattended session open. After IDLE_MS of no activity we sign out; in the
 * final WARN_SECONDS we show a non-blocking countdown. Last-activity is shared
 * across tabs via localStorage so an idle background tab can't sign out an
 * active one. Window is set by VITE_SESSION_IDLE_MINUTES (default 30).
 */
const WARN_SECONDS = 60;
const ACTIVITY_WRITE_THROTTLE_MS = 5_000;
const LAST_ACTIVITY_KEY = "salt:last-activity";
const IDLE_LOGOUT_KEY = "salt:idle-logout";

/** Idle window in ms from env; missing / non-numeric / ≤0 fall back to default. */
function resolveIdleMs(raw: string | undefined, fallbackMinutes = 30): number {
  const mins = raw == null || raw === "" ? NaN : Number(raw);
  const safe = Number.isFinite(mins) && mins > 0 ? mins : fallbackMinutes;
  return safe * 60_000;
}

/** Pure idle decision: expired yet, and seconds to display (null = no warning). */
function idleStatus(
  elapsedMs: number,
  idleMs: number,
  warnSeconds: number,
): { expired: boolean; secondsLeft: number | null } {
  if (elapsedMs >= idleMs) return { expired: true, secondsLeft: 0 };
  const secondsLeft = Math.ceil((idleMs - elapsedMs) / 1000);
  return { expired: false, secondsLeft: secondsLeft <= warnSeconds ? secondsLeft : null };
}

const IDLE_MS = resolveIdleMs(import.meta.env.VITE_SESSION_IDLE_MINUTES as string | undefined);

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
  /** UPI payee address (e.g. "shop@okhdfcbank") for collection pay-links. */
  upi_vpa: string | null;
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

  // Idle auto-logout state (SALT-115). secondsLeft is non-null only inside the
  // warning window, which drives the countdown banner.
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  // Password-recovery overlay (SALT-114): true after a PASSWORD_RECOVERY event,
  // until the user sets a new password (or cancels).
  const [recoveryMode, setRecoveryMode] = useState(false);
  const lastActivityRef = useRef(0);
  const lastWriteRef = useRef(0);

  /** Reset the idle clock (also the "Stay signed in" action). Stable identity. */
  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastWriteRef.current > ACTIVITY_WRITE_THROTTLE_MS) {
      lastWriteRef.current = now;
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      } catch {
        /* storage unavailable (private mode / disabled) — local timer still works */
      }
    }
    setIdleSecondsLeft((prev) => (prev === null ? prev : null));
  }, []);

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
        .select("id, name, state_code, gstin, address, phone, upi_vpa, cutover_date, is_primary")
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
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
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

  // Idle auto-logout timer: runs only while signed in, fully torn down on sign
  // out. Gated on the user id (not the session object) so token refresh / tab
  // refocus doesn't reset the clock. Each tick also reads other tabs' activity.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    const start = Date.now();
    lastActivityRef.current = start;
    lastWriteRef.current = start;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(start));
    } catch {
      /* storage unavailable */
    }

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    for (const ev of events) window.addEventListener(ev, recordActivity, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") recordActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      let last = lastActivityRef.current;
      try {
        const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
        if (Number.isFinite(stored) && stored > last) {
          last = stored;
          lastActivityRef.current = stored;
        }
      } catch {
        /* storage unavailable */
      }
      const { expired, secondsLeft } = idleStatus(now - last, IDLE_MS, WARN_SECONDS);
      if (expired) {
        try {
          sessionStorage.setItem(IDLE_LOGOUT_KEY, "1");
        } catch {
          /* storage unavailable */
        }
        void client.auth.signOut();
        return;
      }
      setIdleSecondsLeft(secondsLeft);
    }, 1000);

    return () => {
      for (const ev of events) window.removeEventListener(ev, recordActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(intervalId);
      setIdleSecondsLeft(null);
    };
  }, [userId, recordActivity]);

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
      {idleSecondsLeft !== null && (
        <IdleWarningDialog secondsLeft={idleSecondsLeft} onStay={recordActivity} />
      )}
      {recoveryMode && (
        <UpdatePasswordDialog
          onDone={() => setRecoveryMode(false)}
          onCancel={() => {
            setRecoveryMode(false);
            void supabase?.auth.signOut();
          }}
        />
      )}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
