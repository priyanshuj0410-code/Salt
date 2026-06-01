import { create } from "zustand";

/**
 * Rebindable counter shortcuts (SALT-178). The four action hotkeys (the reference shipped in
 * SALT-017) can be remapped per device; the map is persisted to localStorage and overrides the
 * defaults. Input-level navigation (↑/↓/Enter/Esc in the search + bill rows) stays fixed — only
 * these discrete actions are rebindable. Keys use the `react-hotkeys-hook` token format
 * (lowercase, `+`-joined, `mod` = Ctrl/⌘).
 */
export type ShortcutAction = "save" | "hold" | "customer" | "help";

export const SHORTCUT_ORDER: ShortcutAction[] = ["save", "hold", "customer", "help"];

export const SHORTCUT_DEFAULTS: Record<ShortcutAction, string> = {
  save: "f9",
  hold: "f4",
  customer: "mod+k",
  help: "shift+/",
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  save: "Save & Print",
  hold: "Hold bill",
  customer: "Find customer",
  help: "Shortcut help",
};

const STORAGE_KEY = "salt:shortcuts";

function load(): Record<ShortcutAction, string> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return raw
      ? { ...SHORTCUT_DEFAULTS, ...(JSON.parse(raw) as Partial<Record<ShortcutAction, string>>) }
      : { ...SHORTCUT_DEFAULTS };
  } catch {
    return { ...SHORTCUT_DEFAULTS };
  }
}

function persist(km: Record<ShortcutAction, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(km));
  } catch {
    /* private mode / disabled storage — keep in memory only */
  }
}

interface KeymapState {
  keymap: Record<ShortcutAction, string>;
  /** Rebind an action. If `key` is already bound to another action, returns that action and makes
   *  no change (the caller surfaces the conflict); otherwise applies it and returns null. */
  rebind: (action: ShortcutAction, key: string) => ShortcutAction | null;
  reset: () => void;
}

export const useKeymap = create<KeymapState>((set, get) => ({
  keymap: load(),
  rebind: (action, key) => {
    const km = get().keymap;
    const clash = SHORTCUT_ORDER.find((a) => a !== action && km[a] === key);
    if (clash) return clash;
    const next = { ...km, [action]: key };
    persist(next);
    set({ keymap: next });
    return null;
  },
  reset: () => {
    persist(SHORTCUT_DEFAULTS);
    set({ keymap: { ...SHORTCUT_DEFAULTS } });
  },
}));

/**
 * Build a `react-hotkeys-hook` key token from a keydown event, e.g. Ctrl+S → "mod+s",
 * F8 → "f8", Shift+/ → "shift+/". Returns null for a bare modifier (keep waiting for the
 * real key) or for Escape (the editor uses it to cancel).
 */
export function keyFromEvent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (e.key === "Escape" || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("mod");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return [...mods, e.key.toLowerCase()].join("+");
}

/** Human-readable rendering of a key token, e.g. "mod+k" → "Ctrl + K", "shift+/" → "Shift + /". */
export function formatKey(key: string): string {
  return key
    .split("+")
    .map((p) =>
      p === "mod" ? "Ctrl" : p === "shift" ? "Shift" : p === "alt" ? "Alt" : p.toUpperCase(),
    )
    .join(" + ");
}
