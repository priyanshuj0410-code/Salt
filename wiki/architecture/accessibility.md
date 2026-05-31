---
type: architecture
updated: 2026-06-01
tags: [nfr, a11y]
---

# Accessibility (WCAG 2.1 AA) — audit & status

A11y audit for SALT-139. Records what already conforms, what the nfr lane fixed
globally, and the narrow set of gaps handed off to the owning modules. Re-run
this audit whenever the app shell or design tokens change.

## Foundations — conforming (verified in code)

| Area | Status | Where / WCAG |
|---|---|---|
| Page language | ✅ `<html lang="en">` | `apps/web/index.html` · 3.1.1 |
| Zoom not blocked | ✅ viewport is `width=device-width, initial-scale=1` — no `user-scalable=no` / `maximum-scale` | `index.html` · 1.4.4 / 1.4.10 |
| Visible focus | ✅ shadcn primitives carry `focus-visible:ring-*`; raw number inputs too | `components/ui/button.tsx`, `billing/BillTable.tsx` · 2.4.7 |
| Icon-only buttons labelled | ✅ `aria-label` on collapse/expand, sign-out, remove-line, qty ±, search, menu | `nav/Sidebar.tsx`, `nav/AppLayout.tsx`, `billing/BillTable.tsx` · 4.1.2 |
| Form fields labelled | ✅ qty/discount inputs use `aria-label="… for {item}"` | `billing/BillTable.tsx` · 1.3.1 / 4.1.2 |
| Landmarks | ✅ `<nav>` (sidebar), `<header>`, `<main>` | `nav/Sidebar.tsx`, `nav/AppLayout.tsx` · 1.3.1 |
| Images / alt text | ✅ N/A — no `<img>`; all icons are inline lucide SVG (decorative) | — |
| Reduced motion | ✅ **added by SALT-139** — global `prefers-reduced-motion` neutralises transitions/animations | `apps/web/src/index.css` · 2.3.3 |
| Error/loading resilience | ✅ `ErrorBoundary` + content Suspense (SALT-133) — no white-screen on a failed lazy chunk | `App.tsx`, `components/ErrorBoundary.tsx` |

## Gaps — handed off (land in module / design-system files)

The nfr lane owns the app shell and global CSS; per-screen and token fixes are
filed to their owners rather than edited here.

- **Skip-to-content link — missing.** The keyboard path into `<main>` should be a
  visually-hidden "Skip to content" link as the first focusable element, with an
  `id` on `<main>`. Lives in `nav/AppLayout.tsx`. → **SALT-158 (nav)**. WCAG 2.4.1.
- **`muted-foreground` contrast is marginal.** `--muted-foreground` = zinc-500
  (`#71717a`) meets AA on white (~4.6:1) but drops to ~4.3:1 on `surface-2`/`muted`
  backgrounds — under the 4.5:1 threshold for normal-size text. Token change is the
  design-system's call. → **SALT-157 (design-system)**. WCAG 1.4.3.

## Needs manual verification (a browser, not code)

Headless tooling can't confirm these — they need a real browser at real sizes
(the user's screenshots are the eyes here). Tracked as the verification half of
SALT-139:

- **Zoom reflow** at 100 / 125 / 150% — no clipping, no horizontal scroll, the
  counter and tables stay usable (1.4.10).
- **Screen range** 13"–24" — layout holds from a small laptop to a large monitor.
- **Dialog focus** — base-ui Dialog should trap focus while open and restore it on
  close (verify for `H1Gate`, `RecordPaymentDialog`, `BatchPicker`) (2.4.3 / 2.1.2).
- **Status not by colour alone** — success/danger dots and badges should pair an
  icon or text label with the colour (1.4.1).

## Related
[architecture/design-system](design-system.md) · [interaction-patterns](interaction-patterns.md) · [screens-routing](screens-routing.md)
