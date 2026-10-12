---
type: design-system
title: Salt design system
description: The authoritative design tokens, principles, and component patterns for Salt's UI. Audited from apps/web/src/index.css (the source of truth) and wiki/architecture/design-system.md. Read before any UI change; update when a new pattern is introduced.
plane_issues:
  - SALT-2 (lens-spine spike — logic-only, introduced no new UI pattern)
  - SALT-20 (DataTable real-design pass — sortable headers, skeleton, empty state)
  - SALT-38 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/29df4720-0e15-465f-a3e7-b20547d30e47 (P1 accessibility: solid focus ring, 3:1 control border)
  - SALT-39 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/368eebfb-9363-4394-bb1c-f4d5201b061d (P2 design gaps: dark values, motion, spacing, density and voice carried in; broken links fixed; contrast.py)
---

# Salt design system

**Source of truth:** [`apps/web/src/index.css`](../apps/web/src/index.css) `@theme` / `:root` / `.dark` tokens. Deep rationale lives in [`wiki/architecture/design-system.md`](../wiki/architecture/design-system.md), the written contract [`design.md`](../design.md) at the repo root and the interactive reference [`salt-design-system.html`](../salt-design-system.html). This OKF doc is the concise contract; the CSS wins on any conflict. Where the root doc lists a token that `index.css` does not define (spacing, motion, shadows, z-index), this doc says so and describes what the code does.

## First principle

**Light, quiet, near-monochrome zinc. Colour is reserved for *state*, never decoration.** The primary action is near-black (`#18181b`), surfaces are zinc-50/100, and the only saturated colour in the UI is success/warning/danger feedback. A screen at rest should read as black text on white with grey chrome. If you reach for an accent colour to make something "pop", stop — that is not this system.

## Tokens (light; dark mode mirrors via `.dark`)

**Surfaces / borders**
- `--background` #ffffff · `--surface` #fafafa (zinc-50) · `--surface-2` #f4f4f5 (zinc-100)
- `--border` #e4e4e7 (zinc-200) · `--border-strong` #d4d4d8 (zinc-300): cards, dividers and decoration only. Never the edge of a control (1.27:1 on white).
- `--control` #898992 (dark #74747d): the border of inputs, selects and outlined buttons, bridged as `--input` (`border-input`). 3.47:1 on background, 3.32:1 on surface, 3.15:1 on surface-2; dark 4.30:1, 3.83:1 and 3.22:1.

**Focus**
- `--focus-ring` follows `--action-primary` (#18181b light, #fafafa dark) and is bridged as `--ring`. It is solid, never translucent: 16.12:1 or more on background, surface and surface-2 in light, 14.27:1 or more in dark.
- One rule in `index.css` draws it for every control: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }`. Do not add `ring-ring/50`, `focus-visible:ring-*` or `outline-none` to a control. Where the edge would be clipped (table rows and cells, the palette input) use `focus-visible:-outline-offset-2`. `outline-none` is only for a container focused by script (`tabIndex={-1}`: `main`, the dialog popup).
- On a dark surface inside the light theme, use a solid white ring (`focus-visible:ring-white`).

**Text** (WCAG AA enforced — see SALT-157)
- `--text-primary` #18181b · `--text-secondary` #52525b · `--text-tertiary` #676770 · `--text-disabled` #a1a1aa · `--text-inverse` #fafafa

**Actions**
- `--action-primary` #18181b, hover #27272a, text #ffffff
- `--action-secondary` #f4f4f5, hover #e4e4e7, text #18181b

**State (the only colour)** — each is a triad `{fg, -bg, -border}`, plus `-on-dark` variants:
- success #166534 / #f0fdf4 / #bbf7d0
- warning #b45309 / #fffbeb / #fde68a
- danger #b91c1c / #fef2f2 / #fecaca

**shadcn/@base-ui bridge:** semantic aliases (`--primary`, `--muted`, `--destructive`, `--input`, `--ring`, `--sidebar-*`, …) map onto the tokens above; use the named utilities (`bg-surface`, `text-text-secondary`, `bg-primary`) not raw hexes.

## Typography

- `--font-sans` **Geist Variable** (Inter fallback) — all UI.
- `--font-mono` **Geist Mono Variable** — numbers, money, codes, Kbd.
- `--font-display` **Fraunces** (serif) — display headings only, sparingly.
- Scale (compact, tabular): xs .6875rem · sm .8125rem · base .9375rem · lg 1.0625rem · xl 1.375rem · 2xl 1.75rem.

## Shape & spacing

- Radius: base `--radius` 0.5rem (8px); sm .25 / md .375 / lg .5 / xl .75rem.
- Tailwind v4 spacing scale; dense, keyboard-first layouts (this is a power-user ERP replacing Marg — see `wiki/design/salt-personas.html`).

## Patterns / primitives

- Built on **shadcn/ui "base-nova"** over `@base-ui/react`. Reuse existing primitives: `ui/kbd` (Kbd), `ui/dialog`, `ui/card`, Dot, Badge.
- **DataTable** (`patterns/data-table.tsx`) is the one table primitive (used in ~40 screens). Codified pattern (SALT-20, grounded in Mercury/Quicken/Midday finance tables via Lazyweb): frozen uppercase header, 1px row dividers (no zebra), right-aligned `tabular-nums` for money/qty, hover tint, ↑/↓ keyboard row focus, desktop-grid→mobile-card reflow, TanStack virtualization for 10k+ rows. **Sortable headers** are opt-in per column (`sortable` + `sortValue`) with a faint two-way chevron that resolves to the active direction; sort cycles asc→desc→off. **Loading** renders skeleton rows that mirror the grid (never a bare "Loading…"). **Empty** is a centred, quiet block (override via the `empty` prop).
- **Truncate** (`patterns/truncate.tsx`): single-line ellipsis that reveals the full value as a native tooltip only when actually clipped. Use for any text that can overflow (names, codes). Money compaction pairs with `formatPaiseCompact` (`lib/currency.ts`, K/L/Cr).
- **Keyboard is the primary input** (`design.md` §2): every navigable action has a shortcut; the command palette (`Ctrl/Cmd+K`) and `?` help overlay are data-driven from `lib/shortcuts.ts` so they never drift. No tooltip-only shortcuts.
- **Money is integer paise**, rendered mono with `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`. Never floats. (V2 finding: also support K/L/Cr compaction + never overflow → truncate+hover.)
- Status is communicated with the state triads above (a coloured Dot/Badge), not with coloured text blocks.

## Sources

Read these when this doc is not enough: [`design.md`](../design.md) §1 principles, §2.3 token usage rules, §4 density, §5 primitives, §6 patterns, §7 accessibility, §8 anti-patterns; [`salt-design-system.html`](../salt-design-system.html) for the visual reference (brand and voice, motion, spacing, density); [`wiki/architecture/design-system.md`](../wiki/architecture/design-system.md) for as-built status and gotchas.

## When you change UI

1. Read this file + `apps/web/src/index.css`. Use existing tokens/primitives — introduce no colour, font, spacing, or component pattern not defined here.
2. If a genuinely new pattern is unavoidable, validate it against real-world UI (Lazyweb) before codifying, then update this file and add the Plane issue to `plane_issues`.
3. Logic-only changes to UI files (gating, routing, state) introduce no design pattern — note that and proceed.
