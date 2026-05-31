import { DEFAULT_FORMAT, isPrintFormat } from "./format";
import { DEFAULT_LANG, isPrintLang, type PrintLang } from "./i18n";
import type { PrintFormat } from "./types";

/**
 * localStorage key for the remembered default print format. The print window's
 * toolbar writes the *same* key directly (it runs in a popup that shares this
 * origin's storage), so a format switch there sticks for the next F9 print.
 */
export const FORMAT_KEY = "salt.print.format";

/** localStorage key for the remembered print language (en / hi / both). */
export const LANG_KEY = "salt.print.lang";

/** The browser-remembered default format used by the F9 Save & Print fast path. */
export function loadDefaultFormat(): PrintFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    if (isPrintFormat(v)) return v;
  } catch {
    // localStorage unavailable (private mode / SSR) — use the built-in default.
  }
  return DEFAULT_FORMAT;
}

export function saveDefaultFormat(f: PrintFormat): void {
  try {
    localStorage.setItem(FORMAT_KEY, f);
  } catch {
    // best-effort; a non-persisted session still prints fine
  }
}

/** The browser-remembered default print language. */
export function loadDefaultLang(): PrintLang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isPrintLang(v)) return v;
  } catch {
    // unavailable — use the built-in default
  }
  return DEFAULT_LANG;
}

export function saveDefaultLang(l: PrintLang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    // best-effort
  }
}
