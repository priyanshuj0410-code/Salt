import { can, MODULES, type ModuleKey, type PermissionOverrides } from "@/lib/permissions";
import type { UserRole } from "@/lib/auth";
import type { AtomId } from "./atoms";
import { atomsForRole } from "./roleAtoms";

/**
 * A user HOLDS a set of capability atoms (A..O, derived from their role in
 * Slice 1); the lens DERIVES everything else from that set — the surface they
 * land on, the one persistent action, their altitude facets — so there is one
 * rule, not seven hand-built role IAs. Ported from the validated prototype
 * (wiki/design/salt-unified-experience.html; the SALT-1 reconciliation +
 * Varanasi test signed it off).
 *
 * Slice 1 keeps `litSurfaces` (the route/nav gate) running through `can()` so
 * there is NO access regression; WS2 will drive it from atoms once the nav is
 * re-homed onto the 8 V2 surfaces. The lens is consumed only when LENS_V2 is on.
 */

/** Every coarse module key. `counter` is omitted from MODULES (always reachable). */
const ALL_KEYS: ModuleKey[] = ["counter", ...MODULES.map((m) => m.key)];

/** V1 route for a primary ModuleKey — the flag-on landing target (until WS2).
 *  INVARIANT (loop-safety depends on it): pathModule(ROUTE_OF[k]) === k, so a
 *  redirect to a primary surface always passes that surface's own route gate. */
const ROUTE_OF: Partial<Record<ModuleKey, string>> = {
  counter: "/",
  reports: "/reports",
  inventory: "/inventory",
  purchases: "/purchases",
  payments: "/payments",
  approvals: "/approvals",
  gst: "/gst",
  salesmen: "/salesmen",
  parties: "/parties",
  settings: "/settings/organisation", // no bare /settings route exists
};

const OPERATE_ATOMS: AtomId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "N", "O"];

/** The surface this user lands on — ported from the prototype's deriveSurface. */
function derivePrimarySurface(atoms: Set<AtomId>): ModuleKey {
  const counter = atoms.has("A") || atoms.has("B") || atoms.has("C");
  if (atoms.has("G") && atoms.size <= 2) return "salesmen"; // field-only → the beat
  if (counter) return "counter";
  if (atoms.has("E") || atoms.has("F") || atoms.has("N")) return "inventory"; // stock / godown
  if (atoms.has("J") || atoms.has("K")) return "reports"; // desk — reconcile & file
  if (atoms.has("L") || atoms.has("I")) return "reports"; // pulse / floor
  if (atoms.has("G")) return "salesmen";
  // Intentional V1 bridge: the prototype falls through to "Home"; there is no V1
  // Home surface until WS2/WS3, so land on the always-reachable counter.
  return "counter";
}

/** The one persistent action — ported from the prototype's deriveVerb. */
function deriveVerb(atoms: Set<AtomId>): string {
  if (atoms.has("I")) return "Approve · Inbox";
  if (atoms.has("J") || atoms.has("K")) return "Export";
  if (atoms.has("A") || atoms.has("C")) return "Find";
  if (atoms.has("G")) return "Sync + collect";
  if (atoms.has("B")) return "Bill";
  return "—";
}

/** Altitude facets — DERIVED from atoms, not a stored knob (this resolves the
 *  3-vs-5 dispute: altitude falls out of which atoms you hold). */
function deriveAltitudes(atoms: Set<AtomId>): string[] {
  const f: string[] = [];
  if (atoms.has("L")) f.push("watch");
  if (OPERATE_ATOMS.some((x) => atoms.has(x))) f.push("operate");
  if (atoms.has("I")) f.push("approve");
  if (atoms.has("J") || atoms.has("K")) f.push("file");
  if (atoms.has("M")) f.push("configure");
  return f;
}

export interface Lens {
  /** The capability atoms this user holds (Slice 1: derived from role). */
  heldAtoms: Set<AtomId>;
  /** Surfaces this user may see/reach — the single gate for routes AND nav.
   *  Kept `can()`-based in Slice 1 (no gating regression); atom-driven in WS2. */
  litSurfaces: Set<ModuleKey>;
  /** The surface this user lands on, derived from their atoms. */
  primarySurface: ModuleKey;
  /** The V1 route for `primarySurface` — the flag-on landing target. */
  primaryRoute: string;
  /** The one always-present action, derived from atoms (Bill/Find/Approve/Export/Sync). */
  persistentAction: string;
  /** Altitude facets this user operates at — derived from atoms, not stored. */
  altitudes: string[];
}

export function deriveLens(
  role: UserRole | undefined,
  perms: PermissionOverrides | null | undefined,
): Lens {
  const heldAtoms = atomsForRole(role);
  const primarySurface = derivePrimarySurface(heldAtoms);
  return {
    heldAtoms,
    litSurfaces: new Set<ModuleKey>(ALL_KEYS.filter((k) => can(role, perms, k))),
    primarySurface,
    primaryRoute: ROUTE_OF[primarySurface] ?? "/",
    persistentAction: deriveVerb(heldAtoms),
    altitudes: deriveAltitudes(heldAtoms),
  };
}
