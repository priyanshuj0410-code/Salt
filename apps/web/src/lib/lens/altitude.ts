import { useCallback, useMemo, useState } from "react";

import { MODULE_SURFACE, type SurfaceKey } from "./surfaces";
import type { Lens } from "./deriveLens";

/**
 * Altitude (the SALT-4 lens facet, now consumed by the shell). A user operates
 * at one altitude at a time; the shell brings that altitude's surfaces FORWARD
 * and tucks the rest into "More" — the prototype's "counter by day, books & GST
 * by evening" progressive disclosure that keeps the solo owner's near-union of
 * surfaces calm. DISPLAY-ONLY: this reorders/groups nav, it NEVER gates — the
 * security boundary stays `lens.litModules`.
 */
export type Altitude = "operate" | "watch" | "file" | "setup";

export const ALTITUDE_LABEL: Record<Altitude, string> = {
  operate: "Operate",
  watch: "Watch",
  file: "File",
  setup: "Setup",
};

const ORDER: Altitude[] = ["operate", "watch", "file", "setup"];

/** Surfaces that come FORWARD at each altitude; everything else tucks into More. */
const ALTITUDE_SURFACES: Record<Altitude, SurfaceKey[]> = {
  operate: ["counter", "buy", "stock", "field"],
  watch: ["home", "money"],
  file: ["money", "comply"],
  setup: ["setup"],
};

/** Derived facets (watch/operate/approve/file/configure) → user-facing modes. */
const FACET_TO_ALTITUDE: Record<string, Altitude> = {
  operate: "operate",
  watch: "watch",
  approve: "watch", // an approvals inbox is oversight
  file: "file",
  configure: "setup",
};

/** The altitude modes this user can switch between, derived from lens.altitudes. */
export function heldAltitudes(lens: Lens): Altitude[] {
  const held = new Set<Altitude>();
  for (const facet of lens.altitudes) {
    const a = FACET_TO_ALTITUDE[facet];
    if (a) held.add(a);
  }
  return ORDER.filter((a) => held.has(a));
}

/** Default active altitude — the one containing the lens's primary surface. */
export function defaultAltitude(lens: Lens, held: Altitude[]): Altitude {
  const primary = MODULE_SURFACE[lens.primarySurface];
  return held.find((a) => ALTITUDE_SURFACES[a].includes(primary)) ?? held[0] ?? "operate";
}

/** Split visible surfaces into the active altitude's FRONT set and tucked More. */
export function splitByAltitude<T extends { surface: SurfaceKey }>(
  surfaces: T[],
  active: Altitude,
): { front: T[]; more: T[] } {
  const front = new Set(ALTITUDE_SURFACES[active]);
  return {
    front: surfaces.filter((s) => front.has(s.surface)),
    more: surfaces.filter((s) => !front.has(s.surface)),
  };
}

const KEY = "salt.altitude";

/** The active altitude (persisted per browser), its setter, and the held modes. */
export function useAltitude(lens: Lens): { active: Altitude; setActive: (a: Altitude) => void; held: Altitude[] } {
  const held = useMemo(() => heldAltitudes(lens), [lens]);
  const [stored, setStored] = useState<Altitude | null>(() => {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return v && (ORDER as string[]).includes(v) ? (v as Altitude) : null;
  });
  // A stored altitude the user no longer holds falls back to the derived default.
  const active = stored && held.includes(stored) ? stored : defaultAltitude(lens, held);
  const setActive = useCallback((a: Altitude) => {
    setStored(a);
    try {
      localStorage.setItem(KEY, a);
    } catch {
      // ignore storage failures (e.g. private mode)
    }
  }, []);
  return { active, setActive, held };
}
