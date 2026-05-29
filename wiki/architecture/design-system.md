---
type: architecture
updated: 2026-05-29
---

# Design system

Source of truth: **`design.md`** (the contract) + `salt-design-system.html` (visual reference). Both are raw sources at repo root — ingest from them, don't restate them in full.

## Principles (priority order, from `design.md` §1)

1. **Speed before delight** — cashiers on 12-hour shifts; spend the visual budget on density and clear state, not motion.
2. **Keyboard is primary** — every mouse action has a visible-hint keyboard equivalent; focus states are first-class.
3. **Trust through precision** — right-aligned tabular numbers, explicit saved/saving/failed states.
4. **Quiet by default, loud only when needed** — near-white surfaces; color reserved for state.
5. **Two densities, one system** — `compact` (counter) vs `default` (owner) share tokens/primitives; only spacing + row height change.
6. **Indian-first** — `en-IN` currency (₹1,00,000), bilingual where it matters.

## The token contract

`design.md` §2 defines CSS custom properties as the single source of truth: neutrals (zinc scale), action, semantic (separate **on-light** tints vs **on-dark** shades), spacing (4px base), type (Geist / Geist Mono / Fraunces-for-wordmark-only, six sizes xs→2xl), radii, shadows, motion, z-index, and density vars. **Rule: never hardcode a color/spacing/size — use the token.** The cardinal sin is using an on-light semantic color as a background fill (muddy); use on-dark shades or `-bg`/`-border` tints.

Primitives (§5): Button, Input, Badge, Kbd, Dot, Card. Patterns (§6): DataTable, StatCard, PageHeader, EmptyState, FormRow, Toast (all toasts share one dark surface + accent — never flood the bg with a semantic color).

## As-built vs the spec — known gap

The shipped app uses **Tailwind v4 + shadcn "base-nova" on `@base-ui/react`** with a neutral theme and Geist font, which matches the *spirit* of `design.md`. But it does **not** fully implement the prescribed token layer: the named CSS custom properties (`--color-surface`, semantic on-light/on-dark pairs, density vars), the `data-density` compact/default switch, and the full primitive/pattern set are **not** wired up as specified. Screens currently use Tailwind/shadcn defaults rather than the `bg-surface text-text-secondary` token utilities the doc mandates.

**Reconciliation is pending** — before building many more owner/counter screens, wiring the token system from `design.md` §2 would prevent drift. Worth a decision record when tackled.

## Related
[stack](stack.md) · [overview](../overview.md)
