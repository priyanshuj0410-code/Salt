---
type: design-system
title: Salt design system
description: The authoritative design tokens, principles, and component patterns for Salt's UI. Audited from apps/web/src/index.css (the source of truth) and wiki/architecture/design-system.md. Read before any UI change; update when a new pattern is introduced.
plane_issues:
  - SALT-2 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/86714868-7786-45d3-9236-e18e982143ac (lens-spine spike, logic-only, introduced no new UI pattern)
  - SALT-20 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/fd2533bf-dcf6-4a5d-b6fd-22ecedf46fe3 (DataTable real-design pass, sortable headers, skeleton, empty state)
  - SALT-38 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/29df4720-0e15-465f-a3e7-b20547d30e47 (P1 accessibility: solid focus ring, 3:1 control border)
  - SALT-39 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/368eebfb-9363-4394-bb1c-f4d5201b061d (P2 design gaps: dark values, motion, spacing, density and voice carried in; broken links fixed; contrast.py)
  - SALT-40 https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/e6df6d91-6802-4904-8e86-4967821aa473 (P3 design gaps: legacy HTML docs aligned with the focus and control values, voice refused words, spelling and dash rules, dash check in contrast.py)
---

# Salt design system

**Source of truth:** [`apps/web/src/index.css`](../apps/web/src/index.css) `@theme` / `:root` / `.dark` tokens. Deep rationale lives in [`wiki/architecture/design-system.md`](../wiki/architecture/design-system.md), the written contract [`design.md`](../design.md) at the repo root and the interactive reference [`salt-design-system.html`](../salt-design-system.html). This OKF doc is the concise contract; the CSS wins on any conflict. Where the root doc lists a token that `index.css` does not define (spacing, motion, shadows, z-index), this doc says so and describes what the code does.

## First principle

**Light, quiet, near-monochrome zinc. Colour is reserved for *state*, never decoration.** The primary action is near-black (`#18181b`), surfaces are zinc-50/100, and the only saturated colour in the UI is success/warning/danger feedback. A screen at rest should read as black text on white with grey chrome. If you reach for an accent colour to make something "pop", stop: that is not this system.

## Tokens (light; dark mode mirrors via `.dark`)

**Surfaces / borders**
- `--background` #ffffff · `--surface` #fafafa (zinc-50) · `--surface-2` #f4f4f5 (zinc-100)
- `--border` #e4e4e7 (zinc-200) · `--border-strong` #d4d4d8 (zinc-300): cards, dividers and decoration only. Never the edge of a control (1.27:1 on white).
- `--control` #898992 (dark #74747d): the border of inputs, selects and outlined buttons, bridged as `--input` (`border-input`). 3.47:1 on background, 3.32:1 on surface, 3.15:1 on surface-2; dark 4.30:1, 3.83:1 and 3.22:1.

**Focus**
- `--focus-ring` follows `--action-primary` (#18181b light, #fafafa dark) and is bridged as `--ring`. It is solid, never translucent: 16.12:1 or more on background, surface and surface-2 in light, 14.27:1 or more in dark.
- One rule in `index.css` draws it for every control: `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }`. Do not add `ring-ring/50`, `focus-visible:ring-*` or `outline-none` to a control. Where the edge would be clipped (table rows and cells, the palette input) use `focus-visible:-outline-offset-2`. `outline-none` is only for a container focused by script (`tabIndex={-1}`: `main`, the dialog popup).
- On a dark surface inside the light theme, use a solid white ring (`focus-visible:ring-white`).

**Text** (WCAG AA enforced, see SALT-157)
- `--text-primary` #18181b · `--text-secondary` #52525b · `--text-tertiary` #676770 · `--text-disabled` #a1a1aa · `--text-inverse` #fafafa

**Actions**
- `--action-primary` #18181b, hover #27272a, text #ffffff
- `--action-secondary` #f4f4f5, hover #e4e4e7, text #18181b

**State (the only colour)**: each is a triad `{fg, -bg, -border}`, plus `-on-dark` variants:
- success #166534 / #f0fdf4 / #bbf7d0
- warning #b45309 / #fffbeb / #fde68a
- danger #b91c1c / #fef2f2 / #fecaca
- info #1e40af / #eff6ff / #bfdbfe

**Dark theme** (`.dark` on an ancestor; `index.css` is the source, the `-on-dark` shades are the dark values of the state colours). Anything not listed here is the same in both themes.

| Token | Light | Dark |
|---|---|---|
| `--background` | #ffffff | #09090b (zinc-950) |
| `--surface` | #fafafa | #18181b (zinc-900) |
| `--surface-2` | #f4f4f5 | #27272a (zinc-800) |
| `--border` / `--divider` | #e4e4e7 / #f4f4f5 | #27272a / #27272a |
| `--border-strong` | #d4d4d8 | #3f3f46 |
| `--control` | #898992 | #74747d |
| `--text-primary` | #18181b | #fafafa |
| `--text-secondary` | #52525b | #a1a1aa |
| `--text-tertiary` | #676770 | #92929b |
| `--text-disabled` | #a1a1aa | #52525b |
| `--text-inverse` | #fafafa | #18181b |
| `--action-primary` (hover, text) | #18181b (#27272a, #ffffff) | #fafafa (#e4e4e7, #18181b) |
| `--action-secondary` (hover, text) | #f4f4f5 (#e4e4e7, #18181b) | #27272a (#3f3f46, #fafafa) |
| `--focus-ring` | #18181b (follows action-primary) | #fafafa |
| success fg / bg / border | #166534 / #f0fdf4 / #bbf7d0 | #4ade80 / #052e16 / #166534 |
| warning fg / bg / border | #b45309 / #fffbeb / #fde68a | #fbbf24 / #422006 / #b45309 |
| danger fg / bg / border | #b91c1c / #fef2f2 / #fecaca | #f87171 / #450a0a / #b91c1c |
| info fg / bg / border | #1e40af / #eff6ff / #bfdbfe | #93c5fd / #172554 / #1e40af |

Computed in `knowledge/contrast.py` (58 of 58 pass): text-tertiary is 5.09:1 on surface-2 in light and 4.83:1 in dark; the control border and focus ring figures above hold in both themes; every state fg holds 4.5:1 on its own bg and on the page background in both themes; the on-dark dots hold 3:1 on the dark surface. The root doc's rule "text-tertiary never on surface-2" predates SALT-157 and no longer applies. Run `python3 knowledge/contrast.py` after any token change.

**shadcn/@base-ui bridge:** semantic aliases (`--primary`, `--muted`, `--destructive`, `--input`, `--ring`, `--sidebar-*`, …) map onto the tokens above; use the named utilities (`bg-surface`, `text-text-secondary`, `bg-primary`) not raw hexes.

## Typography

- `--font-sans` **Geist Variable** (Inter fallback): all UI.
- `--font-mono` **Geist Mono Variable**: numbers, money, codes, Kbd.
- `--font-display` **Fraunces** (serif): display headings only, sparingly.
- Scale (six steps, no improvised sizes; `text-[13px]` is banned, it is `text-sm`), with the line height each step carries: xs .6875rem (11px, 1.4) · sm .8125rem (13px, 1.45) · base .9375rem (15px, 1.45) · lg 1.0625rem (17px, 1.3) · xl 1.375rem (22px, 1.2) · 2xl 1.75rem (28px, 1.1).
- Tabular numerals (`tabular-nums`) wherever money, quantity, percent or a count lives. Uppercase labels: `text-xs uppercase tracking-wide font-semibold text-text-tertiary`.

## Shape & spacing

- Radius: base `--radius` 0.5rem (8px); sm .25 / md .375 / lg .5 / xl .75rem.
- **Spacing is Tailwind's 4px scale**, so `p-3` is 12px. The documented steps are 1 (4px), 2 (8px), 3 (12px), 4 (16px), 5 (20px), 6 (24px), 8 (32px) and 12 (48px): 1 to 3 inside compact components (icon to label, badge gaps, input padding), 4 to 8 between sections (form rows 4, card body 5, page sections and header padding 6). The root doc's `--space-*` variables are not defined in `index.css`; the code uses the utilities directly. It also uses half steps the root doc does not list (`1.5` = 6px in about 150 places, `2.5` = 10px, `0.5` = 2px), so treat those as tolerated, not spec.
- **Density** has two modes on one set of tokens, set with `data-density` on the screen container (`patterns/page.tsx`, which also sets `px-4 py-5 sm:px-6`). Components read `--row-height` and `--input-height`; never build a separate compact component.

| | Compact (counter) | Default (owner) |
|---|---|---|
| Row height (`--row-height-*`) | 36px | 44px |
| Input height (`--input-height-*`) | 32px | 36px |
| Body text | `text-sm` (13px) | `text-base` (15px) |
| Card padding | space-3 to space-4 | space-5 |

Density is desktop only; mobile relaxes to touch sizing. Dense, keyboard-first layouts: this is a power-user ERP replacing Marg (see `wiki/design/salt-personas.html`).

## Motion

Functional, never decorative: speed comes first (root `design.md` §1), so nothing may delay the cashier seeing the result of an action.

- **The scale** (root `design.md` §2.1, `salt-design-system.html` Motion): instant 50ms (opacity-only micro changes), fast 120ms (hover, focus, button press), medium 200ms (dropdown open, slide-in), slow 320ms (modal enter, full-screen transitions); easing `cubic-bezier(0.2, 0.8, 0.2, 1)` out, `cubic-bezier(0.4, 0, 0.2, 1)` in-out.
- **What the code does:** `index.css` defines no `--duration-*` or `--ease-*` variables. Components use Tailwind `duration-100`, `duration-150` and `duration-200`, the `tw-animate-css` `animate-in` and `animate-out` on `Dialog` and `Sheet`, `animate-pulse` on `DataTable` skeleton rows and on a live `Dot` (`pulse`), and `animate-spin` for busy. Stay inside the scale above when adding any.
- **Reduced motion:** one global rule in `index.css` sets animation and transition durations to 0.01ms, iteration count to 1 and scroll behaviour to auto under `prefers-reduced-motion: reduce`; the live `Dot` also carries `motion-reduce:animate-none`. A new animation needs no extra handling, but must not be the only carrier of a state.
- **Hard rule:** Save & Print never animates its exit; the bill clears instantly so the next sale can start. No celebrations on save, no toast for a primary action (inline feedback instead).

## Voice

From `salt-design-system.html` (Brand, Voice); the root `design.md` has no voice section.

- **Direct.** "Bill saved", not "Your bill has been saved successfully."
- **Operational.** Name the action the cashier is doing: "Save & Print", not "Complete transaction". The button shows its key ("Save & Print · F9").
- **Calm.** No marketing exclamation marks, no emoji in product UI, no celebration.
- **Bilingual where it matters.** Item names and Hindi text sit side by side ("Crocin 500" next to its Hindi name); short English action words such as "Pay" stay English because cashiers prefer them.
- Money and dates follow `en-IN` (see Patterns below); status is text or an icon plus colour, never colour alone.

**Refused words and patterns:** "successfully", "Oops", "Sorry", "Congratulations", "Complete transaction", exclamation marks and emoji in product UI, and any error that does not say what to do next.

| Do | Don't |
|---|---|
| "Bill saved" / "Save & Print · F9" | "Your bill has been saved successfully." / "Complete transaction" |
| "Save timed out: it may have gone through. Check Bills before retrying." | "Oops! Something went wrong. Try again later." |

**Spelling:** British English in prose and copy (colour, organisation, behaviour), with `en-IN` formats for money and dates. Code identifiers keep their names (`--color-*`, `text-text-primary`); do not rename them to match the prose.

**Dashes:** no en dash (U+2013) or em dash (U+2014) anywhere in the design docs or the product's copy. Ranges use a hyphen (3-6, 2-8°C); an empty table value is a hyphen; a pause is a comma, colon, full stop or parentheses. `python3 knowledge/contrast.py` fails if one appears in the design docs or in a user-facing string under `apps/web/src` (comments are not checked).

## Patterns / primitives

- Built on **shadcn/ui "base-nova"** over `@base-ui/react`. Reuse existing primitives: `ui/kbd` (Kbd), `ui/dialog`, `ui/card`, Dot, Badge.
- **DataTable** (`patterns/data-table.tsx`) is the one table primitive (used in ~40 screens). Codified pattern (SALT-20, grounded in Mercury/Quicken/Midday finance tables via Lazyweb): frozen uppercase header, 1px row dividers (no zebra), right-aligned `tabular-nums` for money/qty, hover tint, ↑/↓ keyboard row focus, desktop-grid→mobile-card reflow, TanStack virtualization for 10k+ rows. **Sortable headers** are opt-in per column (`sortable` + `sortValue`) with a faint two-way chevron that resolves to the active direction; sort cycles asc→desc→off. **Loading** renders skeleton rows that mirror the grid (never a bare "Loading…"). **Empty** is a centred, quiet block (override via the `empty` prop).
- **Truncate** (`patterns/truncate.tsx`): single-line ellipsis that reveals the full value as a native tooltip only when actually clipped. Use for any text that can overflow (names, codes). Money compaction pairs with `formatPaiseCompact` (`lib/currency.ts`, K/L/Cr).
- **Keyboard is the primary input** (`design.md` §2): every navigable action has a shortcut; the command palette (`Ctrl/Cmd+K`) and `?` help overlay are data-driven from `lib/shortcuts.ts` so they never drift. No tooltip-only shortcuts.
- **Money is integer paise**, rendered mono with `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`. Never floats. (V2 finding: also support K/L/Cr compaction + never overflow → truncate+hover.)
- Status is communicated with the state triads above (a coloured Dot/Badge), not with coloured text blocks.

## Sources

Read these when this doc is not enough: [`design.md`](../design.md) §1 principles, §2.3 token usage rules, §4 density, §5 primitives, §6 patterns, §7 accessibility, §8 anti-patterns; [`salt-design-system.html`](../salt-design-system.html) for the visual reference (brand and voice, motion, spacing, density; its focus ring, control border and text-tertiary values were aligned with `index.css` on 12 October 2026, [SALT-40](https://app.plane.so/claude-pri/projects/1454eb99-703c-4a36-9d03-f311d11d6e97/issues/e6df6d91-6802-4904-8e86-4967821aa473), and the CSS still wins on any difference); [`wiki/architecture/design-system.md`](../wiki/architecture/design-system.md) for as-built status and gotchas.

## When you change UI

1. Read this file + `apps/web/src/index.css`. Use existing tokens/primitives: introduce no colour, font, spacing, or component pattern not defined here.
2. If a genuinely new pattern is unavoidable, validate it against real-world UI (Lazyweb) before codifying, then update this file and add the Plane issue to `plane_issues`.
3. Logic-only changes to UI files (gating, routing, state) introduce no design pattern, note that and proceed.
