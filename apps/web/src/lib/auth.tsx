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
import {
  effectivePermissions,
  type Permission,
  type PermissionOverride,
  type UserRole,
} from "./permissions";
import { IdleWarningDialog } from "@/components/auth/IdleWarningDialog";
import { UpdatePasswordDialog } from "@/components/auth/UpdatePasswordDialog";
import { MfaChallengeDialog } from "@/components/auth/MfaChallengeDialog";

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

/** Per-org localStorage key for the session's active shop (SALT-173). */
const activeShopKey = (orgId: string) => `salt:active-shop:${orgId}`;

function readActiveShop(orgId: string): string | null {
  try {
    return localStorage.getItem(activeShopKey(orgId));
  } catch {
    return null; // storage unavailable (private mode / disabled)
  }
}

function writeActiveShop(orgId: string, shopId: string): void {
  try {
    localStorage.setItem(activeShopKey(orgId), shopId);
  } catch {
    /* storage unavailable — the in-memory active shop still works this session */
  }
}

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

/**
 * MFA gate (SALT-113): true when the session is aal1 but a verified factor
 * exists (nextLevel "aal2"), i.e. the user must complete a TOTP challenge.
 */
function needsMfaChallenge(
  aal: { currentLevel: string | null; nextLevel: string | null } | null,
): boolean {
  return !!aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2";
}

// UserRole (5 roles since SALT-174) lives in ./permissions so it can be shared
// with navConfig without an import cycle; re-exported here for existing callers.
export type { UserRole, Permission } from "./permissions";

export interface Membership {
  /** The membership row id — needed to attach per-user permission overrides. */
  id: string;
  orgId: string;
  orgName: string;
  role: UserRole;
}

/** Shop snapshot used app-wide for place-of-supply, GSTIN, header info. */
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
  /** Effective capabilities = role defaults + per-user overrides (SALT-174). */
  permissions: Set<Permission>;
  /** True if the current member has `permission` (role default, honouring overrides). */
  can: (permission: Permission) => boolean;
  /** The active shop id — what every shop-scoped screen reads (SALT-173). */
  shopId: string | null;
  /** Full active-shop record. null until resolved, or if no shop exists yet. */
  shop: Shop | null;
  /** All shops in the org, primary first then oldest — drives the shop switcher. */
  shops: Shop[];
  /**
   * Switch the session's active shop (SALT-173). Persists per-org to
   * localStorage; does NOT change the org-wide primary (`is_primary`).
   */
  setActiveShop: (shopId: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [permissions, setPermissions] = useState<Set<Permission>>(() => new Set());
  const [shopId, setShopId] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(supabase != null);
  /** The user id the loading gate is tracking, so we ignore same-user refires. */
  const currentUserId = useRef<string | null>(null);

  // Idle auto-logout state (SALT-115). secondsLeft is non-null only inside the
  // warning window, which drives the countdown banner.
  const [idleSecondsLeft, setIdleSecondsLeft] = useState<number | null>(null);
  // Password-recovery overlay (SALT-114): true after a PASSWORD_RECOVERY event,
  // until the user sets a new password (or cancels).
  const [recoveryMode, setRecoveryMode] = useState(false);
  // MFA login gate (SALT-113): true while a verified-factor user is still aal1.
  const [mfaChallengeRequired, setMfaChallengeRequired] = useState(false);
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
      .select("id, role, org_id, orgs(name)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (data) {
      const org = data.orgs as { name: string } | { name: string }[] | null;
      const orgName = Array.isArray(org) ? (org[0]?.name ?? "") : (org?.name ?? "");
      const role = data.role as UserRole;
      setMembership({ id: data.id as string, orgId: data.org_id as string, orgName, role });

      // Per-user permission overrides (SALT-174). The membership_permissions
      // table may be absent on a DB where migration 0044 has not yet run — on
      // any error, fall back to the role's default capabilities (no lockout).
      let overrides: PermissionOverride[] = [];
      const { data: ovr, error: ovrErr } = await supabase
        .from("membership_permissions")
        .select("permission, granted")
        .eq("membership_id", data.id as string);
      if (!ovrErr && Array.isArray(ovr)) overrides = ovr as unknown as PermissionOverride[];
      setPermissions(effectivePermissions(role, overrides));
      // Resolve the org's shops (SALT-173). Ordered primary-first then oldest,
      // so the primary (or, absent one, the oldest) is the deterministic
      // fallback. This covers orgs whose imports created shops without ever
      // marking one primary (the common case for the four-file Saral import).
      // Tolerates absence (pre-migration or no shop yet): leaves shop null and
      // billing guards on it.
      const orgId = data.org_id as string;
      const { data: shopRows } = await supabase
        .from("shops")
        .select("id, name, state_code, gstin, address, phone, upi_vpa, cutover_date, is_primary")
        .eq("org_id", orgId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      const rows = (shopRows ?? []) as Array<Shop & { is_primary: boolean }>;
      if (rows.length > 0) {
        const list: Shop[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          state_code: r.state_code,
          gstin: r.gstin,
          address: r.address,
          phone: r.phone,
          upi_vpa: r.upi_vpa,
          cutover_date: r.cutover_date,
        }));
        setShops(list);
        // Ensure a deterministic primary fallback exists: if none is flagged,
        // self-heal by promoting the oldest (rows[0] after the ordering).
        const hasPrimary = rows.some((r) => r.is_primary);
        const primaryId = (hasPrimary ? rows.find((r) => r.is_primary) : rows[0])!.id;
        if (!hasPrimary) {
          // Errors are swallowed — a unique-per-org race (another tab promoting a
          // different shop) resolves on the next refresh().
          await supabase.from("shops").update({ is_primary: true }).eq("id", primaryId);
        }
        // Active shop = the session's stored choice if it still exists, else the
        // primary. Never flips is_primary; the choice persists across reloads.
        const stored = readActiveShop(orgId);
        const active = list.find((s) => s.id === stored) ?? list.find((s) => s.id === primaryId) ?? list[0];
        setShop(active);
        setShopId(active.id);
      } else {
        setShops([]);
        setShop(null);
        setShopId(null);
      }
    } else {
      setMembership(null);
      setPermissions(new Set());
      setShopId(null);
      setShop(null);
      setShops([]);
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
        setMfaChallengeRequired(false); // re-evaluated by the AAL effect
      } else {
        setMembership(null);
        setPermissions(new Set());
        setShopId(null);
        setShop(null);
        setShops([]);
        setMfaChallengeRequired(false);
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

  // MFA gate (SALT-113): when signed in, check the session's assurance level and
  // require a challenge if a verified factor exists but the session is aal1.
  useEffect(() => {
    if (!supabase || !userId) return;
    const client = supabase;
    let active = true;
    void client.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (active) setMfaChallengeRequired(needsMfaChallenge(data));
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const can = useCallback(
    (permission: Permission) => permissions.has(permission),
    [permissions],
  );

  const setActiveShop = useCallback(
    (id: string) => {
      const next = shops.find((s) => s.id === id);
      if (!next || !membership) return;
      setShop(next);
      setShopId(next.id);
      writeActiveShop(membership.orgId, id);
    },
    [shops, membership],
  );

  const refresh = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) await loadMembership(userId);
  }, [session?.user.id, loadMembership]);

  async function signOut() {
    await supabase?.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, membership, permissions, can, shopId, shop, shops, setActiveShop, loading, refresh, signOut }}
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
      {mfaChallengeRequired && (
        <MfaChallengeDialog
          onVerified={() => setMfaChallengeRequired(false)}
          onCancel={() => {
            setMfaChallengeRequired(false);
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
