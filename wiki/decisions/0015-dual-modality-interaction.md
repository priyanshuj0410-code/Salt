---
type: decision
updated: 2026-05-31
---

# 0015 — Dual-modality interaction: one system for keyboard and touch

**Status:** accepted (design) · **Date:** 2026-05-31

## Context

Salt serves two users at once: a **keyboard power-user** at a desktop counter (the speed benchmark —
type → `Enter` to add a line → `F9` to save) and a **touch user** on a phone or tablet. Reviewing the
counter on a phone exposed the problem: it was a dense, keyboard-first screen made merely "responsive,"
so on touch it felt boring and unfriendly (a 7-column grid that side-scrolled, the primary action buried
in a desktop sidebar). Consumer apps (Swiggy Instamart was the reference shown) make touch feel effortless
— prominent context selection, a clean cart, an obvious "add GSTIN," a sticky pay+confirm footer — but
adopting that wholesale would slow the keyboard pro with extra taps and hidden actions.

`design.md` already declares "speed before delight" and "keyboard is primary" (§1) and ships two
densities (§4), but it has **no rule for how one screen serves both modalities at peak without
compromising either** — no persistent-action/sticky pattern, no sheet/disclosure model, no statement
that every action must be reachable by both input methods. The patterns layer (`components/patterns/`:
DataTable/StatCard/PageHeader/EmptyState) and the `data-density` switch have since been built, so the
foundation to formalise this now exists.

## Decision

Adopt **one dual-modality interaction system** rather than two designs (or a keyboard UI with touch
bolted on). The contract, documented in [architecture/interaction-patterns](../architecture/interaction-patterns.md):

> **One model, two presentations, dual input always present.** Content and capability are
> modality-independent; only layout density, placement, and disclosure adapt at the `md` breakpoint.
> Every action is reachable by **both** a keyboard shortcut (shown as a visible `Kbd` hint) **and** an
> adequately-sized touch target.

Seven laws (L1–L7) operationalise it: one model/two presentations; dual input always; a persistent
primary action (pane-footer + `Kbd` on desktop / sticky thumb bar on mobile); type-ahead-first entry;
lists as adaptive records (table ↔ cards, **edit = open one, never a bulk grid**); disclosure by
density; consistent primitives. Four primitives are added to carry the contract internally —
`EntityHeader`, `ActionBar`, a responsive `Sheet`, and `FormRow` — so screens inherit peak-both behaviour
by composing the kit. The counter is rebuilt as the **reference implementation** that proves the desktop
keyboard path is byte-for-byte unchanged while mobile becomes a staged, thumb-first flow from the same
components.

## Consequences

- **Positive.** Keyboard speed is protected by construction (the desktop presentation is the existing
  dense path); touch becomes first-class, not an afterthought; consistency is inherited from a fixed kit,
  not re-derived per screen; new screens get a checklist instead of a blank canvas.
- **Cost.** Four new primitives to build and maintain; existing screens need a conformance pass to adopt
  them; some components carry both a shortcut and a touch affordance (a little extra markup).
- **Boundaries.** `design.md` stays the immutable raw source; the laws live in the wiki and may be
  promoted into `design.md` by the curator once stable. This is an interaction/UI decision only — it
  changes **no** data model or RPC (the counter already models `payment`, and GSTIN lives on `ledgers`).
- **Rejected alternatives.** (a) Separate mobile and desktop layouts — diverges, doubles maintenance,
  breaks consistency. (b) Make the counter touch-first like Swiggy — regresses the keyboard benchmark.
  (c) Leave it responsive-only — the status quo that prompted this.

## Related

[architecture/interaction-patterns](../architecture/interaction-patterns.md) ·
[architecture/design-system](../architecture/design-system.md) ·
[architecture/billing-screen](../architecture/billing-screen.md) · raw: `design.md` §1, §4, §6, §7
