import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { NAV } from "./navConfig";

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
        return; // no recent `g` — not a go-to chord
      }
      armedAt.current = 0;

      const mod = NAV.find((m) => m.key === key);
      if (!mod || !mod.built || !mod.path) return;
      if (role && !mod.roles.includes(role)) return;
      e.preventDefault();
      navigate(mod.path);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, role]);
}
