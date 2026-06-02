---
type: architecture
updated: 2026-06-02
---

# Screens & routing

All routes are declared in `apps/web/src/App.tsx`. The router is react-router-dom v7. The sidebar + keyboard go-to map are driven by `apps/web/src/components/nav/navConfig.ts` — the single source of truth for what is navigable.

> **CI-guarded invariant (SALT-142).** `apps/web/scripts/check-nav.mjs` (CI step "Nav route invariant"; locally `pnpm --filter web check:nav`) fails the build when navConfig and App.tsx drift: every `built: true` nav node must carry a `path`, and every nav `path` must resolve to a real `<Route>`. So "per-module on ship" — add the route + flip `built: true` — is enforced, not just convention.

> ⚠️ **The route table below is partial / stale** (it predates the inventory, GST, reports, payments, catalogue, settings and purchases routes). `App.tsx` + `navConfig.ts` are authoritative; reconciling this table fully is its own task.

## App shell (`AppLayout`)

`components/nav/AppLayout.tsx` is the persistent frame wrapped around every authenticated route (it renders the routed screen into its `<Outlet/>`):

- **Desktop (lg+):** a persistent left `Sidebar`. **Below lg:** the sidebar collapses to an off-canvas drawer opened from a slim top bar (touch-first); Escape closes it. There is no desktop top bar — screens render their own `PageHeader`.
- The routed screen lives in `<main id="main-content" tabIndex={-1}>`.
- Keyboard plumbing is mounted here: `useGoToNav` (the `g`-then-key go-to map), `useGlobalShortcuts`, and the `CommandPalette` + `ShortcutHelp` overlays.

**Skip to content (SALT-158 — WCAG 2.4.1 Bypass Blocks).** The shell's first focusable element is a visually-hidden `<a href="#main-content">` revealed on focus (`sr-only` + `focus:not-sr-only`), so keyboard / screen-reader users can jump past the sidebar; `<main>` carries `id="main-content"` + `tabIndex={-1}` so activating the link moves both focus and scroll. *Gotcha:* `not-sr-only` resets `padding` and `position`, so the chip's `px`/`absolute` utilities must be `focus:`-scoped or they are clobbered when it becomes visible.

## Route table

| Path | Component | Auth guard | Notes |
|---|---|---|---|
| `/login` | `LoginPage` | none | Email/password + Google OAuth |
| `/onboarding` | `OnboardingPage` | none | Create org or join via invite code |
| `/` | `BillingScreen` | `ProtectedRoute` (any role) | Core counter; accessible to cashier and owner |
| `/owner` | `OwnerHome` | `ProtectedRoute` (owner only) | Cashier invite management |
| `/parties` | `PartiesPage` | `ProtectedRoute` (owner only) | Party ledger management + merge |
| `/parties/:id` | `PartyProfilePage` | `ProtectedRoute` (owner only) | Party profile: details, amount due, orders, open bills, New sale/purchase |
| `/parties/:id/purchase` | `PurchaseEntryPage` | `ProtectedRoute` (owner only) | Vendor purchase entry (GRN-lite): add items, batch/qty/PTR/MRP, adds stock |
| `/bills` | `BillHistoryPage` | `ProtectedRoute` (owner only) | Saved sales (bills) history + line detail |
| `/import` | `ImportPage` | `ProtectedRoute` (owner only) | CSV / Go migrator / Smart Importer entry |
| `/import/smart` | `SmartImportPage` | `ProtectedRoute` (owner only) | Cascade stepper (lazy-loaded) |
| `*` | `Navigate → /` | — | Catch-all redirect |

## ProtectedRoute

Three checks in order, each a redirect if failed:

1. No Supabase session → `/login`
2. Session but no org membership → `/onboarding`
3. `allowedRoles` provided and user's membership role not in it → `/`

Only `BillingScreen` is reachable by cashiers. Every other non-auth route uses `allowedRoles={["owner"]}`.

## Auth loading gate

`AuthProvider` (`lib/auth.tsx`) exposes a `loading` flag that `ProtectedRoute` renders as a full-screen "Loading…". The gate is held only during the **initial session bootstrap and a genuine sign-in** (while membership is fetched), keyed on a change of `session.user.id`. Supabase re-fires `onAuthStateChange` on tab focus / token refresh with the *same* user; those refires must **not** flip `loading` (a `useRef` of the current user id guards this) — otherwise the app strands on "Loading…" after every tab switch, since the membership effect (keyed on `user.id`) won't re-run to clear it.

## Lazy loading

Route-level code-splitting is now the default: **every owner-only screen** is wrapped in `React.lazy` + dynamic `import()` in `App.tsx` — only the counter (`BillingScreen`, the cashier hot path) plus the auth/shell screens ship in the initial bundle, so cold-start stays small on low-end shop PCs. The `Suspense` + `ErrorBoundary` live in `AppContent` (inside the `Outlet`), so a chunk load or a single screen crash shows a localized fallback while the sidebar/top-bar chrome stays mounted. Heavy deps ride their own chunks — e.g. SheetJS with `SmartImportPage` (`/import/smart`), and the WhatsApp page (SALT-222) as its own ~12 kB chunk.

## Settings & integrations

Third-party integration screens live in `components/integrations/` and hang off the **Settings** module. The first wired one is **WhatsApp** (SALT-222): a lazy, owner-gated route at `/settings/integrations/whatsapp` with a matching `Settings → WhatsApp` leaf in `navConfig.ts`. It is the worked example of the per-module-on-ship flow — the `<Route>` and the `built: true` leaf land in the same change, keeping the SALT-142 invariant green. The Razorpay screen (`RazorpayPage.tsx`) exists but its routing is deferred to SALT-231. See [integrations-whatsapp](integrations-whatsapp.md).

## Key files

- `apps/web/src/App.tsx` — the `<Routes>` table: route → component, `ProtectedRoute` guard, lazy import.
- `apps/web/src/components/nav/navConfig.ts` — `NAV[]`, the IA / sidebar + go-to source of truth (module → leaf; `built`, `path`, `roles`).
- `apps/web/src/components/nav/AppLayout.tsx` — the app shell (sidebar/drawer/top-bar/`<main>` + skip link).
- `apps/web/src/components/nav/Sidebar.tsx` + `useGoToNav.ts` — render `NAV` and the `g`-then-key go-to map.
- `apps/web/src/components/auth/ProtectedRoute.tsx` — the session / membership / role gate.
- `apps/web/scripts/check-nav.mjs` — the CI nav↔route invariant (SALT-142).

## Data model

None — nav is pure client-side routing + shell, with no tables, RPCs or migrations. Role visibility derives from `lib/permissions` (`rolesForModule`), kept in lock-step with the route-level capability gate; see [security-rls](security-rls.md).

## Current state vs planned

**Built:** the full IA in `navConfig` (Counter, Activity, Approvals, Purchases, Sales, Inventory, Parties, Payments, GST, Reports, Catalogue, Salesmen, Settings) — 68 navigable paths, all CI-verified to resolve; the dual desktop-sidebar / mobile-drawer shell; keyboard go-to + command palette; the skip-to-content link (SALT-158); the WhatsApp integration route (SALT-222).

**Planned / gaps:** reconcile the stale route table above with `App.tsx` (its own task); wire the Razorpay integration screen (SALT-231); several `built: false` leaves stay disabled in the sidebar until their screens are linked. Only `BillingScreen` is cashier-reachable; every other route is owner-gated.

## Related
[architecture/stack](stack.md) · [security-rls](security-rls.md) · [architecture/billing-screen](billing-screen.md) · [accessibility](accessibility.md) · [interaction-patterns](interaction-patterns.md) · [integrations-whatsapp](integrations-whatsapp.md)
