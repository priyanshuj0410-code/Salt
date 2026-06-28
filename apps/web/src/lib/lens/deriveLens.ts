import { can, MODULES, type ModuleKey, type PermissionOverrides } from "@/lib/permissions";
import type { UserRole } from "@/lib/auth";

/**
 * SALT-2 spike — the V2 capability-lens, derived at runtime from a user's live
 * membership (role + per-user grant/revoke). The whole app view is a function of
 * which surfaces are "lit" for this user, computed in ONE place so the route gate
 * and the nav surfaces can never disagree (today they do: routes honour per-user
 * overrides via `can()`, the sidebar only role-defaults via `rolesForModule`).
 *
 * The spike derives the lit set from `can()` over every module key — the bridge
 * from V1's coarse module model to the lens. The full WS1 lens will derive it
 * from the 15 capability atoms (A..O) a user holds, and will add primarySurface
 * (home) + persistentAction once real consumers exist. Atom→surface seed
 * (wiki/design/salt-unified-experience.html): A sell→counter · B bill→sales ·
 * I credit→approvals · D order / E receive→purchases · F stock→inventory ·
 * H→payments · J keep-books→parties · K file-GST→gst · L pulse→reports ·
 * M configure→settings · G field-beat→salesmen.
 */

/** Every coarse module key. `counter` is omitted from MODULES (always reachable). */
const ALL_KEYS: ModuleKey[] = ["counter", ...MODULES.map((m) => m.key)];

export interface Lens {
  /** Surfaces this user may see/reach — the single gate for routes AND nav. */
  litSurfaces: Set<ModuleKey>;
}

export function deriveLens(
  role: UserRole | undefined,
  perms: PermissionOverrides | null | undefined,
): Lens {
  return { litSurfaces: new Set<ModuleKey>(ALL_KEYS.filter((k) => can(role, perms, k))) };
}
