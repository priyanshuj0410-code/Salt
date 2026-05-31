import { create } from "zustand";

/** Cross-screen UI overlays (command palette, keyboard help) — opened from the
 *  global shortcut layer, the mobile top-bar search button, or anywhere. */
interface UIState {
  paletteOpen: boolean;
  helpOpen: boolean;
  openPalette: () => void;
  openHelp: () => void;
  setPaletteOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  helpOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  openHelp: () => set({ helpOpen: true }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
}));
