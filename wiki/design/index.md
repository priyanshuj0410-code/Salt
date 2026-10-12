---
type: design-index
updated: 2026-06-03
status: working-draft
tags: [ia, redesign, v2, personas, artifacts]
---

> 🚧 **WORKING SET: V2 definition in progress.** These are **living design artifacts**, evolving from ongoing **V1 testing & feedback**, not a finalized spec. The running plan is [../product/ia-redesign-plan.md](../product/ia-redesign-plan.md); the durable model is [../architecture/ia-redesign.md](../architecture/ia-redesign.md).

# Design: V2 IA redesign artifacts

Interactive, self-contained HTML artifacts (open in a browser) produced while defining the **V2 information architecture** from V1's as-built state and the user personas. All built in the Salt design system. **Read in order:**

## 1 · Understand V1 + the users
- [salt-ia-systems-map.html](salt-ia-systems-map.html): the **current (V1) IA**: 13 modules, ~70 screens, the data backbone, and the structural smells (Reports silo, Money split, Settings junk-drawer, two sales models). Grounded in `navConfig.ts` + `App.tsx` + migrations.
- [salt-personas.html](salt-personas.html): the **7 personas** (tier-2/3, English-second-language, Marg keyboard power-users) + their outside-the-ERP apps + a cross-persona behaviour matrix.
- [salt-medicine-lifecycle.html](salt-medicine-lifecycle.html): the **medicine lifecycle** (manufacture → consumption, 15 stages) with persona roles, overlaid with **build + market coverage** (vs Marg / GoFrugal / RetailGraph / eVitalRx / Tally).

## 2 · The proposed per-role IAs (one spine, seven views)
- [salt-owner-ia.html](salt-owner-ia.html): **Owner**: Home pulse + 5 areas + Setup; Reports dissolved, Money unified, Compliance unified.
- [salt-manager-ia.html](salt-manager-ia.html): **Manager**: Floor + Inbox + 5 (operates, no Setup).
- [salt-accountant-ia.html](salt-accountant-ia.html): **Accountant**: Desk + Export + Books + Tax (operations collapse to numbers).
- [salt-pharmacist-ia.html](salt-pharmacist-ia.html): **Pharmacist**: Dispense (home = a working screen) + Salt-search + Shelf + Drug-book; compliance as an inline gate.
- [salt-cashier-ia.html](salt-cashier-ia.html): **Cashier**: the limit case: one screen; the "navigation is a keystroke sequence".
- [salt-fieldsalesman-ia.html](salt-fieldsalesman-ia.html): **Field salesman**: the fork: a separate offline-first mobile app (interactive phone).
- [salt-shopsalesman-ia.html](salt-shopsalesman-ia.html): **Shop salesman**: the selling counter; the unified product lookup.

## 3 · The reconciliation
- [salt-unified-experience.html](salt-unified-experience.html): **one experience, seven views**: capability atoms × altitude × context → a derived lens; personas become presets. Includes the **Varanasi wholesale** real-shop validation. *(Interactive composer, toggle capabilities / load presets.)*

## Then read
- [../product/ia-redesign-plan.md](../product/ia-redesign-plan.md): coverage audit + workstreams + estimates (+ multi-platform, invoice interchange, Marg connector appendices). **The working plan.**
- [../architecture/ia-redesign.md](../architecture/ia-redesign.md): the durable model: the three knobs, the 15-atom registry, the no-V3 thesis.

## Related
[../architecture/information-architecture.md](../architecture/information-architecture.md) (the V1 IA notes) · [../domain/persona-wholesale-owner.md](../domain/persona-wholesale-owner.md) · [../product/market-research.md](../product/market-research.md)
