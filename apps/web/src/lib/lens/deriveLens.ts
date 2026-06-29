import { can, MODULES, type ModuleKey, type PermissionOverrides } from "@/lib/permissions";
import type { UserRole } from "@/lib/auth";
import { ATOM_BY_ID, type AtomId } from "./atoms";
import { atomsForRole } from "./roleAtoms";
import { MODULE_SURFACE, type SurfaceKey } from "./surfaces";

/**
 * A user HOLDS a set of capability atoms (A..O, derived from their role in
 * Slice 1); the lens DERIVES everything else from that set — the surface they
 * land on, the one persistent action, their altitude facets — so there is one
 * rule, not seven hand-built role IAs. Ported from the validated prototype
 * (wiki/design/salt-unified-experience.html; the SALT-1 reconciliation +
 * Varanasi test signed it off).
 *
 * `litModules` (the route/nav gate) runs through `can()` and stays at MODULE
 * granularity BY DESIGN — it is the security boundary, so it must equal `can()`
 * exactly (no access regression). The atom-derived `surfaces` set is the display
 * layer the shell groups by; it never gates. The lens is consumed only when
 * LENS_V2 is on.
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

/** Where the persistent action takes you — mirrors deriveVerb's branch order. */
function deriveActionRoute(atoms: Set<AtomId>): string {
  if (atoms.has("I")) return "/approvals"; // Approve · Inbox
  if (atoms.has("J") || atoms.has("K")) return "/reports"; // Export — the desk
  if (atoms.has("A") || atoms.has("C")) return "/"; // Find — at the counter
  if (atoms.has("G")) return "/salesmen"; // Sync + collect — the beat
  return "/"; // Bill — the counter
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

/** The 8 V2 surfaces this user sees in the unified shell — a faithful projection
 *  of the modules their atoms light (NOT a hand-keyed atom→surface map, which would
 *  drop the multi-module atoms I/J/L). Display grouping only; gating stays on
 *  litModules (modules). */
function deriveSurfaces(atoms: Set<AtomId>): Set<SurfaceKey> {
  const s = new Set<SurfaceKey>();
  for (const id of atoms) for (const mod of ATOM_BY_ID[id].modules) s.add(MODULE_SURFACE[mod]);
  return s;
}

export interface Lens {
  /** The capability atoms this user holds (Slice 1: derived from role). */
  heldAtoms: Set<AtomId>;
  /** The V2 surfaces lit in the unified shell (WS2) — display grouping over the
   *  modules in litModules; additive, never widens access. */
  surfaces: Set<SurfaceKey>;
  /** The modules this user may reach — the single route/nav GATE (= can()). The
   *  surface set is display only; THIS is the security boundary. */
  litModules: Set<ModuleKey>;
  /** The surface this user lands on, derived from their atoms. */
  primarySurface: ModuleKey;
  /** The V1 route for `primarySurface` — the flag-on landing target. */
  primaryRoute: string;
  /** The one always-present action, derived from atoms (Bill/Find/Approve/Export/Sync)
   *  + the route it takes you to. */
  persistentAction: { label: string; route: string };
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
    surfaces: deriveSurfaces(heldAtoms),
    litModules: new Set<ModuleKey>(ALL_KEYS.filter((k) => can(role, perms, k))),
    primarySurface,
    primaryRoute: ROUTE_OF[primarySurface] ?? "/",
    persistentAction: { label: deriveVerb(heldAtoms), route: deriveActionRoute(heldAtoms) },
    altitudes: deriveAltitudes(heldAtoms),
  };
}
