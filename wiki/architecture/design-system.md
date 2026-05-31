---
type: architecture
updated: 2026-05-31
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

## As-built vs the spec — status (2026-05-31)

Refreshed after a design-system review — the earlier "the token layer is not wired up" note is **superseded**. The redesign PRs **#29 (token foundation + Geist + density)** and **#30 (Kbd/Dot primitives, semantic Badge, spec Button/Input)** landed the foundation. Verified against the code:

| Layer | `design.md` | State | Evidence |
|---|---|---|---|
| **Tokens** | §2 | ✅ wired | `apps/web/src/index.css` `@theme` — neutrals, action, semantic on-light **and** on-dark, focus, type, radii, shadows, motion |
| **Fonts** | §3 | ✅ wired | Geist + Geist Mono `@fontsource-variable`, imported in `main.tsx`; `.tabular-nums` helper for aligned money/qty columns |
| **Primitives** | §5 | ✅ built | `components/ui/`: Button, Input, Badge, Kbd, Dot, Card (+ Dialog, Separator, Table). Verified token-faithful: `Dot` (§5.5 6px, `bg-success`…), `Kbd` (§5.4 mono, `surface-2`, 2px bottom-border, `md:`-only), `Badge` (§5.3 `strong` = solid `text-primary` + inverse) |
| **Two-density switch** | §4 | 🟡 partial | the `[data-density="compact"\|default"]` selectors **are** wired in `index.css` (drive `--row-height`/`--input-height`), but **no component sets `data-density`** and no `.tsx` reads the row-height var — the mechanism exists, nothing toggles it |
| **Patterns** | §6 | ⬜ not built | no `components/patterns/`; only the base `ui/table.tsx` primitive — **no composed DataTable** (`@tanstack/react-table`, the §6.1 base, isn't a dependency). StatCard/PageHeader/EmptyState/FormRow absent |
| **Screen migration** | §2 rule | 🟡 in progress | grep finds raw `zinc-*` / `text-[NNpx]` still in 5 files: `billing/BillingScreen`, `billing/BillTable`, `nav/Sidebar`, `import/smart/EntityStep`, `settings/OrgSettingsPage` |

The foundation is real; **the gap is now downstream** — the patterns layer, the density switch, and migrating existing screens onto the tokens — not the tokens themselves.

## Research-backed direction (2026-05-31)

A Lazyweb design-research pass on *"overall ERP design system"* (artifact: `.lazyweb/design-research/erp-design-system-2026-05-31/`, local/untracked) cross-checked `design.md` against 2026 enterprise-UX best practice and real dense-table apps (OpenSea, Mercury, ESPN). Conclusion: **`design.md` is already aligned with best practice — the work is implementation, not redesign.** Priorities, in order:

1. **Finish the token migration** — move the 5 screens above off raw `zinc-*`/`[px]` utilities so intent lives in tokens (`bg-surface`, `text-text-secondary`); a future theme/density change then happens in one place. (Dark-mode tokens already exist in `index.css`, so this also unlocks a working dark theme.)
2. **Build one canonical `DataTable` pattern** (§6.1) — Salt is fundamentally a tables product (ledgers, bills, batches, stock, GST). Sticky uppercase header, right-aligned `tabular-nums`, status in a rightmost badge column, **hover-revealed** row actions, ~25 rows/page. Build once, compose into Parties / Bills / Inventory / Reports. Independently validated by the table-UX literature.
3. **Make `data-density` a real switch** (§4) — add the `[data-density="compact"]` overrides and have `DataTable`/`Input` read them; the literature lands on the same "ship a density toggle" answer.
4. **Hold the color-for-state line** — near-monochrome tables, color only on status/deltas; for Salt's signed balances, tint the *sign* (receivable + / payable −), not the row. One inverse "hero" StatCard per screen (§6.2).
5. **Later: per-row sparklines** on money tables (30-day sales per item; receivables trend per party) — an enhancement once the DataTable exists.

**Worth a decision record** (ADR) when the DataTable + density switch are tackled — they set the pattern every back-office screen inherits.

## Related
[stack](stack.md) · [overview](../overview.md)
