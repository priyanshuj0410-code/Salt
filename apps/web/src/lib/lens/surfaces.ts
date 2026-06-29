import type { ModuleKey } from "@/lib/permissions";

/**
 * The 8 V2 surfaces — the unified shell's top-level nav (WS2). The 13 V1 modules
 * fold into these. Surfaces are a GROUPING over existing routes, NOT a URL
 * namespace: no route is renamed, so deep-links/bookmarks are untouched.
 *
 * Gating still runs on ModuleKey (litModules) — the surface set is a DISPLAY
 * filter that decides which surfaces appear in the sidebar; it is not a security
 * boundary. So lighting a surface can never widen access (Slice 1 changes no gate).
 */
export type SurfaceKey =
  | "home" | "counter" | "buy" | "stock" | "money" | "comply" | "field" | "setup";

/**
 * Every V1 ModuleKey folds into exactly one surface (total function — the smoke
 * asserts coverage). Reports/Activity/Approvals → home; Sales → counter; Salesmen
 * → field; etc. This is the projection the lens uses to decide surface visibility.
 */
export const MODULE_SURFACE: Record<ModuleKey, SurfaceKey> = {
  counter: "counter",
  sales: "counter",
  purchases: "buy",
  inventory: "stock",
  catalogue: "stock",
  parties: "money",
  payments: "money",
  salesmen: "field",
  gst: "comply",
  reports: "home",
  activity: "home",
  approvals: "home",
  settings: "setup",
};
