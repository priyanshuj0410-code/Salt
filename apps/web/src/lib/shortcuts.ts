import { NAV } from "@/components/nav/navConfig";
import type { SurfaceNav } from "@/components/nav/surfaceNav";
import type { UserRole } from "@/lib/auth";

/**
 * The single source of truth for the keyboard layer — derived from the nav IA
 * so the command palette, the help overlay, and the global handlers never drift
 * from each other (design.md §2: keyboard is the primary input).
 */

export interface PaletteItem {
  label: string;
  hint?: string; // parent module, for sub-items
  path: string;
  keys?: string[]; // shortcut chips to show on the row
}

const chip = (k: string) => (k === "," ? "," : k.toUpperCase());

/** Every navigable destination for the command palette. V2: the lit surfaces +
 *  their reachable leaves (pass visibleSurfaces); V1: the role-default module nav. */
export function paletteItems(role: UserRole | undefined, surfaces?: SurfaceNav[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  const groups = surfaces ?? NAV.filter((m) => !role || m.roles.includes(role));
  for (const m of groups) {
    if (m.built && m.path) items.push({ label: m.label, path: m.path, keys: ["G", chip(m.key)] });
    for (const c of m.children) {
      if (c.built && c.path && c.path !== m.path) items.push({ label: c.label, hint: m.label, path: c.path });
    }
  }
  return items;
}

/** Marg-compatible function-key aliases → built route (the muscle-memory keys). */
export const MARG_KEYS: Record<string, string> = {
  F2: "/", // new bill / counter
  F8: "/bills", // day book (sales)
};

export interface HelpGroup {
  title: string;
  rows: { label: string; keys: string[] }[];
}

/** Grouped reference for the `?` help overlay. */
export function helpGroups(role: UserRole | undefined, surfaces?: SurfaceNav[]): HelpGroup[] {
  const groups = surfaces ?? NAV.filter((m) => !role || m.roles.includes(role));
  const goTo = groups.filter((m) => m.built && m.path).map((m) => ({
    label: m.label,
    keys: ["G", chip(m.key)],
  }));
  return [
    {
      title: "Global",
      rows: [
        { label: "Command palette", keys: ["Ctrl", "K"] },
        { label: "Keyboard help", keys: ["?"] },
        { label: "New bill", keys: ["F2"] },
        { label: "Bills · day book", keys: ["F8"] },
      ],
    },
    { title: "Go to (press G, then…)", rows: goTo },
    {
      title: "Counter (billing)",
      rows: [
        { label: "Search items", keys: ["type"] },
        { label: "Add highlighted", keys: ["Enter"] },
        { label: "Save bill", keys: ["F9"] },
        { label: "Choose customer", keys: ["Ctrl", "K"] },
      ],
    },
  ];
}
