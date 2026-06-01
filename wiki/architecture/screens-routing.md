---
type: architecture
updated: 2026-05-29
---

# Screens & routing

All routes are declared in `apps/web/src/App.tsx`. The router is react-router-dom v7. The sidebar + keyboard go-to map are driven by `apps/web/src/components/nav/navConfig.ts` — the single source of truth for what is navigable.

> **CI-guarded invariant (SALT-142).** `apps/web/scripts/check-nav.mjs` (CI step "Nav route invariant"; locally `pnpm --filter web check:nav`) fails the build when navConfig and App.tsx drift: every `built: true` nav node must carry a `path`, and every nav `path` must resolve to a real `<Route>`. So "per-module on ship" — add the route + flip `built: true` — is enforced, not just convention.

> ⚠️ **The route table below is partial / stale** (it predates the inventory, GST, reports, payments, catalogue, settings and purchases routes). `App.tsx` + `navConfig.ts` are authoritative; reconciling this table fully is its own task.

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

`SmartImportPage` is the only route wrapped in `React.lazy` + dynamic `import()`. SheetJS (xlsx parser) is large; deferring it keeps the initial bundle small and only pays the parse cost when the owner actually navigates to `/import/smart`. The top-level `<Suspense>` fallback handles the loading state.

## Related
[architecture/stack](stack.md) · [security-rls](security-rls.md) · [architecture/billing-screen](billing-screen.md)
