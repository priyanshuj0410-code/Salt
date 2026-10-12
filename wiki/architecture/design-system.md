---
type: architecture
updated: 2026-06-02
tags: [design-system, frontend, tokens, primitives]
---

# Design system

The presentation layer every Salt screen is built from: the **token contract** (CSS custom properties), the **primitives** (`components/ui/`), and the **patterns** (`components/patterns/`). Pure frontend: **no tables, RPCs, or migrations** (see [Backend footprint](#backend-footprint)).

Source of truth: **`design.md`** (the written contract) + `salt-design-system.html` (visual reference): both raw sources at repo root; ingest from them, don't restate them in full. Module ownership (per `Salt-worktrees/module-map.txt`): **design-system = `apps/web/src/components/ui/` + `apps/web/src/index.css`**. The shared `components/patterns/` are unmapped (cross-lane shared); the dual-modality primitives there are co-specified with [interaction-patterns](interaction-patterns.md) + ADR [0015](../decisions/0015-dual-modality-interaction.md).

## Principles (priority order, from `design.md` §1)

1. **Speed before delight**: cashiers on 12-hour shifts; spend the visual budget on density and clear state, not motion.
2. **Keyboard is primary**: every mouse action has a visible-hint keyboard equivalent; focus states are first-class.
3. **Trust through precision**: right-aligned tabular numbers, explicit saved/saving/failed states.
4. **Quiet by default, loud only when needed**: near-white surfaces; color reserved for state.
5. **Two densities, one system**: `compact` (counter) vs `default` (owner) share tokens/primitives; only spacing + row height change.
6. **Indian-first**: `en-IN` currency (₹1,00,000), bilingual where it matters.

## The token contract

`design.md` §2 defines CSS custom properties in `index.css` as the single source of truth, then `@theme inline` maps them to Tailwind v4 utilities (`bg-surface`, `text-text-secondary`, …). Groups: neutrals (zinc-derived `--surface`/`--surface-2`/`--border`/`--divider`/`--text-*`), action, semantic with **separate on-light tints and on-dark shades**, focus, spacing (4px base), type (Geist / Geist Mono / Fraunces-wordmark-only, six sizes xs→2xl), radii, shadows, motion, z-index, and density vars.

**Rule: never hardcode a color/spacing/size: use the token.** The cardinal sin is using an **on-light semantic color as a background fill** (muddy); use the on-dark shades or the `-bg`/`-border` tints. A `.dark` block redefines the neutrals + semantics, so the same utilities theme dark with no component changes (no user-facing theme toggle ships yet).

## Key files

| File | What |
|---|---|
| `apps/web/src/index.css` | The whole token layer: `@theme` vars, the `.dark` overrides, the `[data-density]` rules, and the `.tabular-nums` helper. **The design-system module's center of gravity.** |
| `components/ui/` | Spec primitives (`design.md` §5): `button`, `input`, `badge`, `kbd`, `dot`, `card`, plus `dialog`, `separator`, `table`, and the responsive `sheet`. |
| `components/patterns/` | Composed patterns (`design.md` §6): `page` (the density-setting screen container), `page-header`, `data-table`, `stat-card`, `empty-state`, `form-row`, and the dual-modality `entity-header` + `action-bar`. |
| `main.tsx` | Imports the Geist / Geist Mono variable fonts (`@fontsource-variable`). |

## As-built vs the spec, all foundations shipped (2026-06-02)

The redesign P-series (PRs **#29** token foundation + Geist + density, **#30** Kbd/Dot/Badge/Button/Input) laid the base; the SALT-14x/15x/22x tickets finished the kit. Verified against `origin/main`:

| Layer | `design.md` | State | Evidence |
|---|---|---|---|
| **Tokens** | §2 | ✅ | `index.css` `@theme`: neutrals, action, semantic on-light **and** on-dark, focus, type, radii, shadows, motion; `.dark` block for dark mode |
| **Fonts** | §3 | ✅ | Geist + Geist Mono `@fontsource-variable` in `main.tsx`; `.tabular-nums` helper for aligned money/qty columns |
| **Primitives** | §5 | ✅ | `components/ui/`: Button, Input, Badge, Kbd, Dot, Card (+ Dialog, Separator, Table, Sheet). Token-faithful: `Dot` (6px, `bg-success`…), `Kbd` (mono, `surface-2`, 2px bottom-border, `md:`-only), `Badge` (`strong` = solid `text-primary` + inverse) |
| **Two-density switch** | §4 | ✅ | `[data-density="compact"\|default"]` in `index.css` drives `--row-height`/`--input-height`, **actually consumed**: `Input` reads `--input-height`, `DataTable` desktop rows read `--row-height` (SALT-147, #191); `patterns/page.tsx` sets `data-density` from its `density` prop |
| **Patterns** | §6 | ✅ | `components/patterns/`: DataTable (adaptive table↔cards, now row-virtualized, SALT-154), StatCard, PageHeader, EmptyState, FormRow (§6.5, SALT-146) |
| **Dual-modality primitives** | ADR 0015 | ✅ | **EntityHeader** (context bar, SALT-144 #182), **ActionBar** (sticky summary+CTA, SALT-143 #184), **Sheet** (bottom-sheet on touch / dialog on `md+`, SALT-145 #181); adopted e.g. by the counter customer bar (SALT-219 #188). See [interaction-patterns](interaction-patterns.md) |
| **Screen migration** | §2 rule | ✅ | Every screen is off raw `zinc-*` / `text-[NNpx]` and onto tokens + mobile reflow: SALT-224 settings (#192), SALT-225 smart-import (#201), SALT-226 owner (#203), SALT-227 parties (#202), SALT-228 auth (#204). Re-scan = **0 legacy tokens** across those screens. Tracking epic SALT-147 closed |
| **Accessibility** | WCAG 2.1 AA | 🟢 | Conforming foundations + WCAG-AA contrast on `text-tertiary` (SALT-157); details + remaining manual-verification items in [accessibility](accessibility.md) |

## Backend footprint

**None: by design.** design-system is a presentation-only module: it owns `index.css` and the component library, and touches **no** Postgres tables, RPCs, or `supabase/migrations/`. A "design-system" change can never require a DB migration. (Contrast the data-bearing modules in [data-model](data-model.md).) This is why a cross-cutting "migrate every screen to tokens" effort can't be one design-system PR. The screens live in other modules' files (see the gotcha below).

## Decisions & gotchas

- **A "consistency pass" decomposes per module.** design-system owns only `ui/` + `index.css`, so a ticket like SALT-147 ("migrate the remaining screens") can only do its in-lane slice here (the density wiring) and must **delegate one ticket per owning module** (→ SALT-224 settings, 225 smart-import, 226 owner, 227 parties, 228 auth, 229 wiki) rather than reach into their files. All shipped; SALT-147 closed.
- **The density switch was inert until consumed.** Defining `[data-density]` vars in CSS does nothing until a component reads them. SALT-147 wired `Input` (`h-[var(--input-height)]`) and `DataTable` rows (`md:min-h-[var(--row-height)]`); the `ui/table` primitive was deliberately **not** touched (only `billing/BillTable` uses it). Counter (`compact`) ⇒ 32px inputs / 36px rows; owner (`default`) ⇒ 36px / 44px.
- **DataTable virtualization assumes a fixed row height.** SALT-154 added optional TanStack-Virtual windowing for 10k+ lists; it engages **desktop-only** with `ROW_PX = 44` (the default `--row-height`). Below `md` rows reflow to variable-height cards and render un-windowed; keyboard ↑/↓ still walks the full list (scroll-to + focus). Don't change `--row-height-default` without updating `ROW_PX`.
- **`text-tertiary` is nudged for contrast.** `#676770` (light) / `#92929b` (dark): darker/lighter than a plain zinc-500 to hit WCAG AA (~5:1) on `surface-2` (SALT-157). Use `text-text-tertiary`, not raw zinc.
- **The counter keeps bespoke composition.** ActionBar/EntityHeader capture the *shape* simple screens share; the billing counter intentionally keeps its richer `BillSummary`/`MobileCheckout` (split tender, compliance gates): adopt the primitive for new simple screens, not by force-fitting the counter.

## Current state vs planned

**Shipped:** the full token layer (incl. dark-mode tokens), every spec primitive + pattern, a real two-density switch, the dual-modality primitives, and a clean app-wide token migration (0 legacy tokens). The kit is feature-complete against `design.md`.

**Planned / not yet built:**
- A **user-facing theme + density toggle** (tokens exist; no settings control wires them yet).
- **Per-row sparklines** on money tables (30-day item sales, receivables trend). An enhancement now that DataTable exists (`design.md` §6.1 future).
- Broader **adoption** of EntityHeader/ActionBar/Sheet across remaining simple screens (the primitives exist; not every screen composes them yet).
- An **ADR** formalizing the DataTable + density-switch contract, since every back-office screen inherits it.

## Research-backed direction (2026-05-31)

A Lazyweb design-research pass on *"overall ERP design system"* (artifact `.lazyweb/design-research/erp-design-system-2026-05-31/`, local/untracked) cross-checked `design.md` against 2026 enterprise-UX best practice and dense-table apps (OpenSea, Mercury, ESPN). Conclusion: **`design.md` was already aligned: the work was implementation, not redesign**, and it is now largely done. The standing principle: hold the **color-for-state** line: near-monochrome tables, color only on status/deltas; for signed balances tint the *sign* (receivable + / payable −), not the row; one inverse "hero" StatCard per screen (§6.2).

## Related
[interaction-patterns](interaction-patterns.md) · [accessibility](accessibility.md) · ADR [0015: dual-modality](../decisions/0015-dual-modality-interaction.md) · [stack](stack.md) · [overview](../overview.md)
