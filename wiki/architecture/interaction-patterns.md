---
type: architecture
updated: 2026-05-31
---

# Interaction patterns — keyboard + touch, one system

Salt has two users at once: the **keyboard power-user** at a desktop counter (a pharmacist on a
12-hour shift who lives in shortcuts) and the **touch user** on a phone or tablet. [design-system](design-system.md)
(from the `design.md` raw source) already says "speed before delight" and "keyboard is primary" (§1)
and ships two densities (§4) — but it never says **how a single screen serves both at peak without
compromising either**. This page is that contract.

> **The problem.** Making a keyboard UI merely "responsive" yields a touch experience that is an
> afterthought — a dense grid that side-scrolls on a phone. Bolting a touch flow onto it slows the
> keyboard pro with extra taps and hidden actions. We refuse both. The counter that triggered this work
> felt boring and unfriendly on a phone yet is a keyboard *speed benchmark* on desktop; it is the worked
> example throughout (see [billing-screen](billing-screen.md)).

## Core principle

> **One model, two presentations, dual input always present.** What is on screen — content **and**
> capability — is modality-independent. Only **layout density, placement, and disclosure** adapt at the
> `md` breakpoint. Every action is reachable by **both** a keyboard shortcut (shown as a visible `Kbd`
> hint) **and** an adequately-sized touch target — never one or the other.

Keyboard and touch are therefore **not two designs**; they are the same components reflowed. Consistency
is inherited from a fixed primitive kit, not re-invented per screen. This is the operational form of
`design.md` §1.2 ("keyboard is primary") and §4 ("two densities, one system").

## The seven laws

| # | Law | Keyboard expression | Touch expression |
|---|---|---|---|
| **L1** | One model, two presentations | dense, multi-pane, fixed-height, internal scroll | single column, page-scroll, thumb-zone actions |
| **L2** | Dual input, always both | shortcut + visible `Kbd` hint on every action | ≥44px target for the same action; `Kbd` auto-hidden (`md:` only) |
| **L3** | Persistent primary action | one CTA in the summary-pane footer, with its `Kbd` | same CTA as a `sticky bottom` bar showing the live total |
| **L4** | Type-ahead first | search field → `↑/↓` → `Enter` adds | same field → tap a result; quick-adds accelerate |
| **L5** | Lists are adaptive records | table rows, focusable, `↑/↓`+`Enter` | cards with tap targets; **edit = "open one," never a bulk grid** |
| **L6** | Disclosure by density | secondary detail inline (density is cheap) | secondary detail behind a sheet / accordion |
| **L7** | Consistent primitives | compose the kit; shortcuts wired into the primitive | compose the same kit; targets/sheets in the primitive |

A screen that composes the kit and obeys L1–L7 is automatically dual-modal and consistent with every
other screen. These are the contract; the rest of this page is how to satisfy it.

## Named patterns and the component that owns each

| Pattern | What it is | Component | Status |
|---|---|---|---|
| **Page + PageHeader** | every screen's frame; title/subtitle/actions that wrap on mobile | `patterns/page.tsx`, `patterns/page-header.tsx` | built |
| **Adaptive record list** | table on desktop ↔ stacked label→value cards on touch; focusable rows (`↑/↓`,`Enter`) | `patterns/data-table.tsx`; editable variant in `billing/BillTable.tsx` | built |
| **StatCard / EmptyState** | summary figures; empty content | `patterns/stat-card.tsx`, `patterns/empty-state.tsx` | built |
| **Kbd / Dot / Badge** | shortcut chip (`md:`-only), status dot, semantic label | `ui/kbd.tsx`, `ui/dot.tsx`, `ui/badge.tsx` | built |
| **Dual navigation** | one destination map, two front-ends: palette + chords + F-keys / drawer + Search button | `command/CommandPalette.tsx`, `nav/*`, `lib/shortcuts.ts` | built |
| **Type-ahead entry** | search-and-add; `↑/↓`+`Enter` or tap; substitute fallback | `billing/ItemSearch.tsx` | built (counter-specific; generalise later) |
| **EntityHeader / context bar** | prominent "what this is for" bar (customer on billing, party on profile) + one key attribute (balance/dues) + a change affordance | `patterns/entity-header.tsx` | ✅ **built (SALT-144)** — icon chip + label/name + optional key attribute + change affordance (`Kbd` hint, interactive-or-static); generalises the counter `CustomerBar`. Adoptions (counter / party profile / vendor) → SALT-219 |
| **ActionBar** | persistent live total + primary CTA (+ secondary/meta); pane-footer with `Kbd` on desktop, `sticky bottom-0` thumb bar on mobile | `patterns/action-bar.tsx` | 🟡 bespoke `useCheckout` + `BillSummary`/`MobileCheckout` (#42); generic pending |
| **Responsive Sheet** | overlay that is a centered dialog on desktop and a bottom sheet on mobile; Esc / scrim closes; focus-trapped | `ui/sheet.tsx` | ✅ **built (SALT-145)** — on the same base-ui Dialog (inherits focus-trap/Esc/scrim); bottom slide-up below `md`, centered `md+`. Overlay migrations → SALT-216. Swipe-to-dismiss deferred |
| **FormRow** | label+control rows; tab order = visual order; stacks ≥44px on mobile (`design.md §6.5`) | `patterns/form-row.tsx` | ✅ **built (SALT-146)** — adopted in settings/parties/payments dialogs |

These primitives carry their dual-modality contract internally, so any screen that uses them gets
peak-both for free — the whole point of L7. **ActionBar and EntityHeader now exist bespoke in the counter**
(PR #42); extracting them into shared `patterns/` components, plus building `Sheet` and `FormRow`, is the
remaining work.

## Worked example — how the counter expresses every law

**Built in PR #42 (2026-05-31)**, bespoke to the counter (see [billing-screen](billing-screen.md)). The
counter is two presentations of the same components, not two designs:

- **L1 / L3 — layout & primary action.** Desktop: a fixed-height two-pane grid (search + line table
  left, summary right) whose summary footer holds the **ActionBar** (total + payment + **Charge ₹X**,
  `F9` hint visible). Mobile: a single scrolling column with the ActionBar as a `sticky` bottom bar in
  the thumb zone. Same total, same action, placement adapts.
- **L2 — dual input.** `F9` saves and shows `Kbd F9` on desktop; the same button is a full-width tap
  target on mobile where the `Kbd` is hidden (`md:` only). Nothing is keyboard- or touch-only.
- **L4 — entry.** `ItemSearch` keeps its keyboard flow (type → `↑/↓` → `Enter`, with the same-salt
  substitute fallback); touch taps the same result rows.
- **L5 — line items.** `BillTable` renders a dense, row-focusable table on desktop and tappable cards
  with `±` steppers on mobile — identical data and capability.
- **L6 — disclosure.** The GST split and credit terms are inline on the desktop summary; on mobile they
  collapse into a "view breakdown" **Sheet**, and `BatchPicker` becomes a Sheet.
- **EntityHeader.** "Billing to: **Walk-in** ▾" / "**Ramesh** · ₹1,240 due ▾" — changed via `Ctrl+K`
  (desktop, `Kbd` shown) or a tap (mobile), reusing `partyDue` from `lib/orders.ts`. The current
  `CustomerPicker` (a bare name/phone list) is enriched inside the Sheet with recent customers,
  balances, and "add new". An inline **Add GSTIN** prompt appears in the ActionBar when the selected
  customer has none (`ledgers.gstin`), since GST capture must never interrupt the sale.

Net result: desktop is the **same dense keyboard counter** (search→Enter→F9, total + payment always
visible — zero added steps); mobile is a **staged, thumb-first flow**; both are literally the same
components. Per-customer "order again" is intentionally **deferred**.

## Building a new screen — checklist

1. Wrap in `Page` + `PageHeader` (`width` by density: counter = full/compact, owner = lg/default).
2. Collections → `DataTable` (or the editable adaptive-record variant). **Never a bulk-editable grid** —
   list → open one (see the Parties pattern in [parties](../domain/parties.md)).
3. The screen's one primary action → `ActionBar` (live context + `Kbd` + sticky on mobile). Secondary
   actions go in `PageHeader` `actions`.
4. Every shortcut also a visible control with a `Kbd` hint; register it through `lib/shortcuts.ts` so the
   palette and `ShortcutHelp` stay in sync.
5. Forms → `FormRow`. Overlays → responsive `Sheet`. Secondary detail → inline on `md+`, Sheet/accordion
   below.
6. Targets ≥44px on touch; visible focus ring on desktop; tab/`↑↓` order = visual order; `Esc`/scrim
   closes overlays (`design.md §7`).

## Anti-patterns (do not do)

- A dense table that **horizontally scrolls** on mobile instead of reflowing to cards.
- A **bulk-editable grid** of records (fat-finger risk, ambiguous save) — list + single-record edit instead.
- A primary action **only** in a sidebar (invisible/unreachable on mobile) **or** only as a sticky bar
  (no keyboard equivalent). It must be both.
- A **tooltip-only** shortcut (`design.md §8`) — if the `Kbd` hint is not inline, the shortcut does not exist.
- Two hand-built layouts for the same screen. If desktop and mobile do not share components, the model
  has leaked into the presentation — refactor until they do.

## Related

[design-system](design-system.md) · [billing-screen](billing-screen.md) ·
[information-architecture](information-architecture.md) · [decisions/0015-dual-modality-interaction](../decisions/0015-dual-modality-interaction.md) ·
raw: `design.md` §1, §4, §5, §6, §7, §8
