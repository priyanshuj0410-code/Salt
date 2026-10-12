import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { LENS_V2 } from "@/lib/flags";
import { useLens } from "@/lib/lens/useLens";
import { NAV, type NavModule } from "./navConfig";
import { visibleSurfaces } from "./surfaceNav";

const FIELD = /^(input|textarea|select)$/i;

/** True when focus is in a text field, so global chords never hijack typing. */
function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || FIELD.test(el.tagName ?? "");
}

/**
 * Gmail-style go-to navigation: press `g`, then a module's letter (e.g. `g a`
 * for Parties) to jump there. Only navigates to BUILT modules the current role
 * can see; disabled/unknown keys are a no-op. Ignores keystrokes while typing
 * in a field (so searching "Glycomet" at the counter never navigates).
 */
export function useGoToNav() {
  const navigate = useNavigate();
  const role = useAuth().membership?.role;
  const lens = useLens();
  const armedAt = useRef(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave other shortcuts alone
      if (inField(e.target)) return;
      const key = e.key.toLowerCase();

      if (key === "g") {
        armedAt.current = Date.now();
        return;
      }
      if (Date.now() - armedAt.current > 650) {
        armedAt.current = 0;
        return; // no recent `g`: not a go-to chord
      }
      armedAt.current = 0;

      // V2: jump to a SURFACE by its chord (visibleSurfaces is already lit +
      // leaf-filtered, and its path is the first reachable leaf); V1: jump to a
      // module by its chord, role-gated.
      const target: NavModule | undefined = LENS_V2
        ? visibleSurfaces(lens).find((s) => s.key === key)
        : NAV.find((m) => m.key === key);
      if (!target || !target.built || !target.path) return;
      if (!LENS_V2 && role && !target.roles.includes(role)) return;
      e.preventDefault();
      navigate(target.path);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, role, lens]);
}
