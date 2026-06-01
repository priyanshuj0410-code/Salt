import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import type { Permission, UserRole } from "@/lib/permissions";
import { firstAllowedNavPath } from "@/components/nav/navConfig";

export function ProtectedRoute({
  children,
  permission,
  allowedRoles,
}: {
  children: ReactNode;
  /** Capability required to open this route (SALT-174), checked via `can()`. */
  permission?: Permission;
  /** Legacy role gate, kept for back-compat; prefer `permission`. */
  allowedRoles?: UserRole[];
}) {
  const { session, membership, loading, can } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  // Signed in but no org yet → onboarding.
  if (!membership) return <Navigate to="/onboarding" replace />;

  // Capability / role gate. On denial, bounce to the member's first allowed
  // screen rather than a hardcoded "/", so a role without the counter (e.g. an
  // accountant) never lands in a redirect loop.
  const denied =
    (permission != null && !can(permission)) ||
    (allowedRoles != null && !allowedRoles.includes(membership.role));
  if (denied) return <Navigate to={firstAllowedNavPath(can)} replace />;

  return <>{children}</>;
}
