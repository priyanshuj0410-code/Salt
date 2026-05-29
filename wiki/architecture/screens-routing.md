---
type: architecture
updated: 2026-05-29
---

# Screens & routing

All routes are declared in `apps/web/src/App.tsx`. The router is react-router-dom v7.

## Route table

| Path | Component | Auth guard | Notes |
|---|---|---|---|
| `/login` | `LoginPage` | none | Email/password + Google OAuth |
| `/onboarding` | `OnboardingPage` | none | Create org or join via invite code |
| `/` | `BillingScreen` | `ProtectedRoute` (any role) | Core counter; accessible to cashier and owner |
| `/owner` | `OwnerHome` | `ProtectedRoute` (owner only) | Cashier invite management |
| `/parties` | `PartiesPage` | `ProtectedRoute` (owner only) | Party ledger management + merge |
| `/parties/:id` | `PartyProfilePage` | `ProtectedRoute` (owner only) | Party profile: details, amount due, orders, open bills, New sale |
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

## Lazy loading

`SmartImportPage` is the only route wrapped in `React.lazy` + dynamic `import()`. SheetJS (xlsx parser) is large; deferring it keeps the initial bundle small and only pays the parse cost when the owner actually navigates to `/import/smart`. The top-level `<Suspense>` fallback handles the loading state.

## Related
[architecture/stack](stack.md) · [security-rls](security-rls.md) · [architecture/billing-screen](billing-screen.md)
