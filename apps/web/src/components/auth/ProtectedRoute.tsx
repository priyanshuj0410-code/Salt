import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type UserRole } from "@/lib/auth";
import { can, pathModule } from "@/lib/permissions";

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-text-tertiary">
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Signed in but no org yet → onboarding.
  if (!membership) return <Navigate to="/onboarding" replace />;

  // Capability gate: the role (+ per-user overrides) must permit this route's
  // module. `counter` ("/") is always allowed, so a denied user lands safely.
  if (!can(membership.role, membership.permissions, pathModule(pathname))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
