import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type UserRole } from "@/lib/auth";
import { can, pathModule } from "@/lib/permissions";
import { LENS_V2 } from "@/lib/flags";
import { useLens } from "@/lib/lens/useLens";

export function ProtectedRoute({
  children,
}: {
  children: ReactNode;
  /**
   * Legacy hint, still accepted so existing routes don't need editing. Access is
   * now derived centrally from the route's module via the capability map
   * (`lib/permissions`), so role/permission changes apply everywhere at once.
   */
  allowedRoles?: UserRole[];
}) {
  const { session, membership, loading } = useAuth();
  const { pathname } = useLocation();
  // Called unconditionally (rules of hooks); tolerates a null membership and is
  // only consulted when the lens flag is on. Cheap + memoized.
  const lens = useLens();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-text-tertiary">
        Loading…
      </div>
    );
  }

  // Unauthenticated: the site root is the marketing landing (/welcome); a deep
  // link to a specific app route still goes to /login so returning users can sign in.
  if (!session) return <Navigate to={pathname === "/" ? "/welcome" : "/login"} replace />;

  // Signed in but no org yet → onboarding.
  if (!membership) return <Navigate to="/onboarding" replace />;

  // V2: land the user on their lens's primary surface (derived from their atoms)
  // instead of the bare counter — e.g. an accountant opens on the desk (reports),
  // not an empty bill. Only redirects away from "/" and only to a surface they
  // can reach; counter-primary users (owner/cashier/pharmacist) are unaffected.
  if (
    LENS_V2 &&
    pathname === "/" &&
    lens.primaryRoute !== "/" &&
    lens.litModules.has(lens.primarySurface)
  ) {
    return <Navigate to={lens.primaryRoute} replace />;
  }

  // Capability gate: the role (+ per-user overrides) must permit this route's
  // module. `counter` ("/") is always allowed, so a denied user lands safely.
  // V2: the same gate is derived from the lens's lit surfaces (one derivation
  // for routes AND nav); V1 path is the unchanged `can()` call.
  const mod = pathModule(pathname);
  const allowed = LENS_V2 ? lens.litModules.has(mod) : can(membership.role, membership.permissions, mod);
  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
