import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type UserRole } from "@/lib/auth";

export function ProtectedRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  /** If set, the user's membership role must be one of these. */
  allowedRoles?: UserRole[];
}) {
  const { session, membership, loading } = useAuth();

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

  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
