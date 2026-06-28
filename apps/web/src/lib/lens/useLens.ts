import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { deriveLens, type Lens } from "./deriveLens";

/**
 * The current user's lens, derived from their live membership. One hydration
 * point so the whole tree shares a single derivation (re-derives only when the
 * role or per-user overrides change). Tolerates a null membership — `deriveLens`
 * / `can()` treat an undefined role as "counter only", so it is safe to call
 * unconditionally (rules of hooks) before any membership-null redirect.
 */
export function useLens(): Lens {
  const { membership } = useAuth();
  const role = membership?.role;
  const perms = membership?.permissions;
  return useMemo(() => deriveLens(role, perms), [role, perms]);
}
