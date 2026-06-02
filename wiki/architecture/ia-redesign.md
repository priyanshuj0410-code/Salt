---
type: architecture
updated: 2026-06-03
status: working-draft
tags: [ia, redesign, v2, capability-lens]
---

> 🚧 **WORKING DOC — V2 definition in progress.** A living synthesis, evolving from **V1 testing & feedback**. Not a finalized spec. Full plan + estimates: [../product/ia-redesign-plan.md](../product/ia-redesign-plan.md). Interactive artifacts: [../design/index.md](../design/index.md).

# IA redesign — the unified capability-lens model (V2)

The durable thinking behind the V2 IA, so it survives even if the interactive artifacts don't.

## Why V1 ≠ V2
V1's IA is **module-shaped** — 13 modules that mirror the data model and the build order (developer-legible, not user-legible). That is the correct **bootstrap** shape: you cannot design the unified lens until all the capabilities exist and the users have been studied. **V2 is the consolidation of what V1 taught us — not a correction.**

## The thesis: one experience, many views
There is **one app**; a "persona" is a **derived view**. A view is a function of three knobs:

1. **Capabilities held** — atomic, assignable jobs (the 15 atoms below).
2. **Altitude** — watch · operate · file (how deep on each capability).
3. **Context** — counter · desk · road · offline (device + connectivity).

From those, the lens **derives**: which surfaces light up, the **Home** (assembled from the held atoms' signals → the role's "first question"), the **one persistent action**, and the **inline gates**. The seven personas are merely **presets**; real shops **mix / drop / share** them. Loading each preset re-derives exactly the per-role IA in [../design/index.md](../design/index.md) — *one projector, seven projections.*

## The 15 capability atoms
`A` sell · `B` bill · `C` dispense-gate (H1/X) · `D` order · `E` receive (GRN) · `F` stock-health · `G` field-beat · `H` payments & collections · `I` credit & approvals · `J` keep-books (Dr/Cr) · `K` file-GST · `L` pulse & reports · `M` configure · **`N` pick/fulfil (godown)** · **`O` supply-compliance (wholesale)**.

*(`N` and `O` were added by the Varanasi real-shop test — additive, no restructure.)*

## Surfaces
**Home** (assembled) · **Counter** (sell / dispense / bill lenses on **one** surface) · **Buy** · **Stock** · **Money** (+ a Books / Dr-Cr depth) · **Comply** · **Field** (mobile) · **Setup** — plus the one **persistent action**: **Inbox / Export / Find / Sync**, derived per lens. Each role's Home re-points to its first question: money-pulse (owner) → live-floor (manager) → reconcile-desk (accountant) → the working dispense/bill screen (pharmacist/cashier) → the beat (field).

## Shared · absent · solo
- **Shared:** an atom can be held by several people; events route to **any holder** (an approval → any approver; an H1 gate → any pharmacist on shift). Interlocks bind to a **capability**, never to a named role.
- **Absent:** an unheld atom doesn't vanish — the system **flags the gap** ("no one reconciles GST — books may drift") or folds it up to the owner. No "missing app", just an unassigned job.
- **Solo:** one person holding every hat gets the **union**, kept calm by altitude + progressive disclosure + mode-switch (counter by day, office by evening).

## The "no V3" thesis
The model **grows by data, not by restructuring**: a new capability = a new atom (auto-homes into the right lenses); a new / shared / solo role = a preset or assignment; a new device = the context knob. The only changes that would force a V3 are **off the three axes** — chiefly **tenancy / identity** (e.g. external, scoped, multi-shop access for a CA). We name those as a conscious bet. **Validated against a real Varanasi wholesale pharmacy** (no restructure; 2 additive atoms + 1 off-axis tenancy item).

## V1 → V2 foundation (quality findings)
Beyond IA re-homing, V2 must invest in **primitive quality** — the gap between "the structure is right" and "it feels right in the first 60 seconds": a real **DataTable**, money formatting (2dp **+** K/L/Cr Indian abbreviation), **truncate-everywhere** (full on hover), the counter's **inline entry grid** (omnidirectional keys + in-cell autocomplete), and **hierarchical discounts** (customer / +vendor / +item, auto-filled from the last order). Plan §13.

## Beyond the IA — new capabilities (additive)
- **Inbound invoice interchange** — auto-capture supplier invoices into a **draft-GRN inbox**, fed by four rails (Salt-network / email-Gmail / GST e-invoice via a GSP / Pharmarack-style partner). Build the inbox, not the network. Plan §14.
- **Marg connector** — a local, **read-only** agent (extends the existing `migrator/`) over HTTPS; a migration / parallel-run bridge **and** a DIY invoice rail from the Marg base. *Not* an API project, *not* raw TCP/IP. Plan §15.
- **Multi-platform** — wrap the one React app (Tauri desktop + Capacitor Android; PWA baseline); Windows + Android worth it, Mac as PWA. Plan §12.

## Related
[../design/index.md](../design/index.md) · [../product/ia-redesign-plan.md](../product/ia-redesign-plan.md) · [information-architecture.md](information-architecture.md) · [../domain/persona-wholesale-owner.md](../domain/persona-wholesale-owner.md) · [../product/market-research.md](../product/market-research.md) · [decisions/0010-gstin-canonical-party-identity](../decisions/0010-gstin-canonical-party-identity.md) · [decisions/0016-vendor-ordering-channel](../decisions/0016-vendor-ordering-channel.md)
