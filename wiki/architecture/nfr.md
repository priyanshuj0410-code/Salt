---
type: architecture
updated: 2026-06-02
tags: [nfr, performance, a11y, resilience]
---

# NFR — performance, error handling, a11y, resilience

The **nfr** lane owns cross-cutting non-functional concerns that live in the app
shell, not a feature surface: route-level **code-splitting** (cold-start),
**error handling** (no white-screens), **accessibility**, and **offline
connectivity awareness**. Filed from the holistic gap analysis as NFR-1…7
(`SALT-133`…`139`, per `salt-prd-v0.3.md`'s NFR targets). This page covers what
shipped in the frontend and where the rest was routed.

## What shipped

### 1. Route code-splitting — cold-start (SALT-133)
`apps/web/src/App.tsx` lazy-loads every owner-only screen via `React.lazy` +
dynamic `import()`. Only the counter (`BillingScreen`, the cashier hot path) and
the auth/shell (`LoginPage`, `OnboardingPage`, `ProtectedRoute`, `AppLayout`) are
in the entry bundle. At ship time this cut initial JS **829 kB → 699 kB** (gzip
241 → 208). The split also pulls `papaparse` (CSV) and `xlsx` (SmartImport) out
of the entry chunk — they load with `/import` and `/import/smart` on demand.

The pattern scales as the app grows: **65 screens are now lazy** (inventory,
purchase-orders, reports, onboarding, settings, GST suites, …), each its own
chunk rather than entry weight.

### 2. Error handling — no white-screens (SALT-133)
`apps/web/src/components/ErrorBoundary.tsx` is a class boundary used **twice**:
around the whole router (last resort) and inside the layout `<Outlet/>`
(`AppContent` in `App.tsx`), paired with a content-area `<Suspense>`. A failed
dynamic import (a **stale chunk after a deploy**) or a single-screen render crash
shows a localized **Reload** card while the sidebar/top-bar chrome stays mounted,
instead of blanking the app. `componentDidCatch` logs stack traces only — no PII.

### 3. Accessibility (SALT-139)
A WCAG 2.1 AA **audit** (→ [accessibility](accessibility.md)) found the
foundations already conform (page `lang`, zoom-enabled viewport, focus-visible,
labelled icon-buttons/inputs, landmarks, no `<img>` alt gaps). The nfr lane added
a global **`prefers-reduced-motion`** rule to `apps/web/src/index.css` (WCAG
2.3.3) that neutralises the `tw-animate-css` / base-ui transitions for users who
opt out at the OS level. Per-screen and token gaps were handed off (below).

### 4. Offline connectivity awareness (SALT-135, slice)
`apps/web/src/lib/useOnlineStatus.ts` (`useSyncExternalStore` over the window
`online`/`offline` events, seeded from `navigator.onLine`) +
`apps/web/src/components/OfflineBanner.tsx` (a fixed, `aria-live` warning bar
mounted once at the app root in `App.tsx`). For the unreliable-shop-internet
persona, a dropped link reads as "you are offline" rather than surfacing later as
a mysterious failed save. **Awareness only** — true offline billing needs the
sync substrate (see Planned).

## Key files
- `apps/web/src/App.tsx` — the lazy route table; `AppContent` (Suspense + boundary inside the layout outlet); the `OfflineBanner` mount.
- `apps/web/src/components/ErrorBoundary.tsx` — render / chunk-load error boundary.
- `apps/web/src/components/OfflineBanner.tsx`, `apps/web/src/lib/useOnlineStatus.ts` — connectivity.
- `apps/web/src/index.css` — global `prefers-reduced-motion`.
- [accessibility](accessibility.md) — the WCAG audit + status.

## Data model / RPCs / migrations
None. The nfr work is entirely frontend / app-shell; it adds no tables, RPCs, or
migrations. (The backend/ops NFRs — backups, residency, audit-trail — live in
[operations](operations.md).)

## Decisions & gotchas
- **Code-splitting lives in `App.tsx`** even though the lock-map tags it `nav`,
  because lazy routes *are* the routing manifest and it is the perf mandate. That
  makes `App.tsx` a **merge hotspot** — every feature lane adds a route there — so
  the lazy restructure conflicts with their additions; resolve by regenerating
  from main deterministically (each new screen just becomes another `lazy()` +
  lazy route). A CI nav↔route guard now enforces the table (SALT-142).
- **Content-level Suspense, not top-level.** One top Suspense would flash a
  full-screen fallback (incl. the nav) on every cross-page navigation; the
  boundary inside the layout `<Outlet/>` keeps the chrome mounted and shows
  "Loading…" only in the content area.
- **Eager counter.** `BillingScreen` stays eager (the default `/`, the
  highest-frequency user) so the counter paints with no chunk round-trip;
  everything owner-only is lazy.
- **`navigator.onLine` is best-effort** — it reflects the network interface, not
  whether Supabase is reachable. Fine for the banner; not a substitute for sync.
- **Bundler is Rolldown-vite (vite v8).** Rely on `React.lazy` dynamic-import
  splitting (bundler-agnostic); avoid bundler-specific `manualChunks` /
  `advancedChunks` config (it can also de-optimise the existing lazy chunks).

## Current state vs planned
**Shipped (PR #62):** code-splitting + `ErrorBoundary` (SALT-133 ✅),
reduced-motion + a11y audit (SALT-139 ✅), the offline connectivity banner
(SALT-135 slice).

**Watch item — entry chunk regrowth.** With 65 screens lazy, the entry bundle is
back to ~810 kB (gzip ~240) as the app 10×'d in modules: code-splitting keeps all
65 screens *out* of it, but the eager baseline (framework + `supabase-js` +
counter + shared UI) has regrown to the pre-split size. Further cold-start wins
would now come from a stable vendor/framework chunk and trimming heavy eager
shared deps — not from more route splitting.

**Handed off to owning lanes** (nfr work spans modules → file a ticket, don't edit
their files):
- 10k-item list virtualization → `SALT-154` (catalogue)
- sub-200ms optimistic counter save → `SALT-155` (billing) ✅ (#169)
- skip-to-content link → `SALT-158` (nav)
- `muted-foreground` contrast → `SALT-157` (design-system) ✅ (#158)
- zoom / screen-size / dialog-focus a11y → manual browser verification (see [accessibility](accessibility.md))

**Re-homed to infra/platform** (backend/ops, not frontend): reliability/backups +
PITR (SALT-134), security/encryption/PII/GDPR (SALT-136 ✅), residency +
audit-trail (SALT-137), scale load-test (SALT-138) — documented in
[operations](operations.md); some blocked on account-owner Supabase-dashboard
actions.

**Planned (epic):** the offline-first **substrate** — 12h offline billing +
local-server failover — needs a sync layer. `SALT-135` was reassigned to
infra/architecture as that epic; the spike + design landed as
[offline-first](offline-first.md) (ADR 0017). See also
[roadmap](../product/roadmap.md) and
[decisions/0002](../decisions/0002-stack-divergence-from-prd.md).

## Related
[accessibility](accessibility.md) · [screens-routing](screens-routing.md) · [operations](operations.md) · [offline-first](offline-first.md) · [decisions/0002 — stack divergence](../decisions/0002-stack-divergence-from-prd.md) · [product/roadmap](../product/roadmap.md)
