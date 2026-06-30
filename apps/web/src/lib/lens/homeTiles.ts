import { ATOM_BY_ID, type AtomId } from "./atoms";
import { MODULE_SURFACE, type SurfaceKey } from "./surfaces";
import type { Lens } from "./deriveLens";

/**
 * The assembled Home (WS3): Home = the union of signal tiles for the atoms a user
 * HOLDS — one rule, not seven hand-built Homes (the validated prototype's
 * "Home -> a derived signal-feed"). This is the pure descriptor; the datum each
 * tile shows is resolved in the AssembledHome component against the shared
 * Dashboard data (reuse tiles) or shown label-only (page-datum / net-new tiles).
 */
export interface HomeTile {
  atom: AtomId;
  /** The atom's one-line home signal (e.g. "today's bills"). */
  label: string;
  surface: SurfaceKey;
  /** Deep-link to the owning page — an existing V1 URL (surfaces don't rename routes). */
  route: string;
}

/** Where each atom's Home tile links. Reuses existing V1 routes verbatim. */
const ATOM_ROUTE: Record<AtomId, string> = {
  A: "/", B: "/", C: "/",
  D: "/inventory/reorder", E: "/purchases", F: "/inventory", N: "/inventory",
  G: "/salesmen",
  H: "/payments", I: "/approvals", J: "/reports",
  K: "/gst/liability", O: "/gst",
  L: "/reports",
  M: "/owner",
};

const SURFACE_ORDER: SurfaceKey[] = ["home", "counter", "money", "comply", "buy", "stock", "field", "setup"];

/**
 * One tile per held atom that carries a home signal (M has none -> no tile),
 * ordered by surface for a stable layout. Pure display grouping — no gating
 * (litModules remains the security boundary).
 */
export function assembledTiles(lens: Lens): HomeTile[] {
  return [...lens.heldAtoms]
    .map((id) => ATOM_BY_ID[id])
    .filter((a) => !!a.home)
    .map((a) => ({ atom: a.id, label: a.home as string, surface: MODULE_SURFACE[a.modules[0]], route: ATOM_ROUTE[a.id] }))
    .sort((x, y) => SURFACE_ORDER.indexOf(x.surface) - SURFACE_ORDER.indexOf(y.surface));
}
