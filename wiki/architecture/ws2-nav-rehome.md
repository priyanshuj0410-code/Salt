---
type: decision
updated: 2026-06-28
tags: [v2, ia-redesign, ws2, lens, nav]
plane_issues: [SALT-5]
---

# WS2 — Unified shell & nav recomposition

The plan for re-homing Salt's **13 V1 nav modules** into the **8 V2 surfaces**, behind `LENS_V2`, incrementally. Grounded + adversarially verified (the verifier caught a real privilege-escalation trap before any code). See the model in [ia-redesign.md](ia-redesign.md) and the validated prototype `wiki/design/salt-unified-experience.html`.

## Strategy: regroup nav, keep every URL

Surfaces are a **grouping over existing routes, not a URL namespace** — no route is renamed, so deep-links / bookmarks / print-share links are untouched. The whole change is nav structure + (later) gating granularity. **~2 days, 2 flag-gated PRs, V1 untouched throughout.**

## The surface map

| Surface | folds in (V1 modules) | root |
|---|---|---|
| **home** | Reports/Dashboard + Activity + Approvals (assembled feed = WS3) | /reports |
| **counter** | Counter + Sales/bills + sales-reports (3 lenses: sell/dispense/bill) | / |
| **buy** | Purchases (all) + purchase-reports | /purchases |
| **stock** | Inventory + Catalogue + inventory-reports | /inventory |
| **money** | Parties + Payments + financial-reports | /parties |
| **comply** | GST (all) + H1/X register + Drug licenses + tax-reports | /gst |
| **field** | Salesmen (mobile projection of atom G) | /salesmen |
| **setup** | Settings (Admin / Data and Import / Integrations) | /owner |

MODULE_SURFACE (in apps/web/src/lib/lens/surfaces.ts) is the total 13->8 fold; every route in App.tsx lands on a surface (nothing orphaned).

## The one correctness rule (the verifier's catch)

A surface aggregates modules with *different* role-reach. So:
- **The route gate never changes** — it stays the proven can()/module check (litSurfaces). The surface set is a **display filter only**, never a security boundary; lighting a surface cannot widen access.
- **Lit surfaces are derived from each atom's modules array** (union-mapped through MODULE_SURFACE), *not* a hand-keyed atom->surface map — else multi-module atoms (I=approvals+payments, J=reports+parties, L=reports+activity) silently drop their home-surface half.
- **Leaves within a surface filter per-module** (lens.litSurfaces.has(pathModule(leaf.path))) — the escalation guard, so an accountant under money still cannot see a module they lack.

## Slices

- **Slice 1 — 8-surface sidebar (SALT-5, shipped):** additive only. New lens/surfaces.ts + nav/surfaceNav.ts; deriveLens gains a surfaces: Set<SurfaceKey> field; the Sidebar V2 branch renders the 8 surfaces (lit by surfaces, leaves filtered by the module gate). **Routes, App.tsx, the gate — untouched.** Zero access risk.
- **Slice 2 — surface-granularity route gate:** switch the route gate to the **dual check** (surface-lit AND module-lit), update **all 5** lit-set consumers atomically (ProtectedRoute, Sidebar, useGoToNav, CommandPalette, ShortcutHelp), + a **5 roles x ~70 routes access-parity test** asserting V2 == V1 can() exactly.

## Deliberately deferred (out of WS2)

Surface-rooted URLs (/money/*, /stock/*) — high-churn, mechanical, best done after the surface nav is proven. The assembled signal-feed **Home** is WS3. The field **mobile** app is the field-app workstream.
