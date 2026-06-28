import { NAV, type NavModule } from "@/components/nav/navConfig";
import type { UserRole } from "@/lib/auth";
import { pathModule, type ModuleKey } from "@/lib/permissions";

/**
 * Whether a module is visible to the user. V2 (lens on): the caller passes the
 * lens's lit surfaces and visibility is the same gate as routes/sidebar. V1:
 * role-default visibility via `m.roles`.
 */
function moduleVisible(m: NavModule, role: UserRole | undefined, lit?: Set<ModuleKey>): boolean {
  if (lit) return m.path != null && lit.has(pathModule(m.path));
  return !role || m.roles.includes(role);
}

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

/** Every navigable destination, visibility-filtered, for the command palette. */
export function paletteItems(role: UserRole | undefined, litSurfaces?: Set<ModuleKey>): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const m of NAV) {
    if (!moduleVisible(m, role, litSurfaces)) continue;
    if (m.built && m.path) {
      items.push({ label: m.label, path: m.path, keys: ["G", chip(m.key)] });
    }
    for (const c of m.children) {
      if (c.built && c.path && c.path !== m.path) {
        items.push({ label: c.label, hint: m.label, path: c.path });
      }
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
export function helpGroups(role: UserRole | undefined, litSurfaces?: Set<ModuleKey>): HelpGroup[] {
  const goTo = NAV.filter((m) => moduleVisible(m, role, litSurfaces) && m.built && m.path).map((m) => ({
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
