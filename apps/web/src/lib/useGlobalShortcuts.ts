import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useUI } from "@/store/ui";
import { MARG_KEYS } from "@/lib/shortcuts";

const FIELD = /^(input|textarea|select)$/i;
function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || FIELD.test(el.tagName ?? ""));
}

/**
 * The global key layer, mounted once in AppLayout:
 *   Ctrl/Cmd+K → command palette (works even while typing — deliberate chord)
 *   F2 / F8    → Marg-compatible navigation aliases (function keys never collide)
 *   ?          → keyboard help (only when not typing, so "?" stays typable)
 * Overlays close on Esc via the Dialog primitive. The g+letter chord lives in
 * useGoToNav; both read the same registry (lib/shortcuts.ts).
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const openPalette = useUI((s) => s.openPalette);
  const openHelp = useUI((s) => s.openHelp);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // On the counter, Ctrl+K stays the customer picker and ? stays the counter
      // help — preserve billing muscle memory. Palette/help are global elsewhere.
      const onCounter = window.location.pathname === "/";
      if (!onCounter && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      const marg = MARG_KEYS[e.key];
      if (marg && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        navigate(marg);
        return;
      }
      if (!onCounter && e.key === "?" && !inField(e.target)) {
        e.preventDefault();
        openHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openPalette, openHelp]);
}
