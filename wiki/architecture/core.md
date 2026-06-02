---
type: architecture
updated: 2026-06-02
tags: [core, app-shell, auth, navigation, multi-shop]
---

# Core (app shell, session context & navigation)

The **core** module is the authenticated application frame that every feature screen renders inside: the session/tenancy context, the route guard, the navigation IA, the app layout, and the multi-shop working context. It owns no business domain of its own — it is the plumbing that gives the rest of the app a signed-in user, an org, an active shop, and a way to move between screens.

> Scope note: the *login / sign-up / SSO* screens are the **auth** module; the role→capability **matrix** is the **settings** module (`lib/permissions.ts`, SALT-091). Core consumes both. The route table itself is detailed in [screens-routing.md](screens-routing.md); the keyboard/touch contract in [interaction-patterns.md](interaction-patterns.md).

## What it provides

### 1. Session & tenancy context — `lib/auth.tsx`
`AuthProvider` is the root context. It resolves, from the Supabase session, the user's **membership** (org + role + per-user permission overrides) and the org's **shops**, and exposes a single `useAuth()` surface:

| Field | Meaning |
|---|---|
| `session` / `user` | Supabase Auth session + user (JWT held client-side). |
| `membership` | `{ orgId, orgName, role, permissions }` — `null` until an org is joined/created (→ onboarding). |
| `shopId` / `shop` | The **active** shop (see §3) — what every shop-scoped screen reads. |
| `shops` | All shops in the org (primary-first), driving the switcher. |
| `setActiveShop(id)` | Switch the session's active shop (SALT-173). |
| `loading` | Gate so the shell shows "Loading…" until membership resolves. |
| `refresh()` / `signOut()` | Re-load membership; sign out. |

`membership.role` is one of five `UserRole`s; `membership.permissions` is a `PermissionOverrides` (`{ grant?, revoke? }`) layered on the role default (per [security-rls.md](security-rls.md)).

### 2. Session-lifecycle gates (shared-terminal hardening)
`AuthProvider` also renders three non-blocking overlays for the pharmacy-counter reality of shared terminals:
- **Idle auto-logout** (SALT-115): signs out after `VITE_SESSION_IDLE_MINUTES` (default 30) of no activity, with a 60s countdown; last-activity is shared across tabs via `localStorage` so an idle background tab can't sign out an active one.
- **MFA challenge** (SALT-113): if the session is `aal1` but a verified TOTP factor exists, it forces a challenge.
- **Password recovery** (SALT-114): a `PASSWORD_RECOVERY` event opens the set-new-password overlay.

### 3. Multi-shop & the active-shop switcher — **SALT-173** (shipped)
An org can own several shops. Core resolves **all** of them (`shops`, ordered `is_primary` first, then oldest) and tracks a **per-session active shop**:
- `shopId` / `shop` reflect the **active** shop, so every shop-scoped screen (counter, GRN, reports) follows the selection with **no per-screen change**.
- `setActiveShop(id)` writes the choice to `localStorage` per-org (`salt:active-shop:<orgId>`) and **never** flips the org-wide primary (`is_primary`). On load, the stored choice is honoured if it still exists, else it falls back to the primary — with a self-heal that promotes the oldest shop to primary when none is flagged (common for the four-file Saral import).
- [`ShopSwitcher.tsx`](../../apps/web/src/components/nav/ShopSwitcher.tsx) is a styled `<select>` in the **Sidebar footer**; it renders nothing for single-shop orgs (no-op). Because the Sidebar is shared by desktop and the mobile drawer, one component covers both.

This is the *transactional* working-shop context — distinct from the **reports** consolidated shop filter (SALT-118), which scopes report suites with an "All shops" view.

### 4. Route guard — `components/auth/ProtectedRoute.tsx`
Wraps every protected route. Order: `loading` → not signed-in (`/login`) → no org (`/onboarding`) → **capability gate**. The gate derives the route's module from the path and checks the member's role + overrides:
```
can(membership.role, membership.permissions, pathModule(pathname))
```
A denied user is sent to `/` (the counter), which is always allowed — so there is no redirect loop. Gating is centralised in `lib/permissions`, so role/permission changes apply to every route at once (no per-route `allowedRoles` lists).

### 5. Navigation IA — `components/nav/navConfig.ts`
`NAV` is the **single source of truth** for both the sidebar **and** the keyboard "go-to" map (`g` then a letter) — so they never drift. Each module declares its landing route, built-state, and `roles: rolesForModule(<module>)` (derived from the same capability matrix as the route guard). [`Sidebar.tsx`](../../apps/web/src/components/nav/Sidebar.tsx) filters modules by `membership.role`; `lib/shortcuts.ts` builds the command palette + `?` help from the same `NAV`.

### 6. App layout & routing — `components/nav/AppLayout.tsx`, `App.tsx`
`AppLayout` is the persistent shell: a left sidebar on desktop (lg+), an off-canvas drawer below lg opened from a slim top bar, plus the command palette and shortcut-help overlays. `App.tsx` is the router: only the counter (the cashier hot path) and the auth/shell ship in the initial bundle; every owner screen is `lazy`-loaded to keep cold-start small on low-end shop PCs.

## Key files
- `apps/web/src/lib/auth.tsx` — `AuthProvider` / `useAuth`, session, membership, active-shop, idle/MFA/recovery gates.
- `apps/web/src/components/nav/ShopSwitcher.tsx` — active-shop switcher (SALT-173).
- `apps/web/src/components/auth/ProtectedRoute.tsx` — capability route gate.
- `apps/web/src/components/nav/navConfig.ts` — IA / nav + keyboard go-to source of truth.
- `apps/web/src/components/nav/{AppLayout,Sidebar,useGoToNav}.tsx` — the shell.
- `apps/web/src/App.tsx` — router (lazy-loaded screens).
- `apps/web/src/lib/permissions.ts` — capability matrix consumed by the guard + nav (settings module / SALT-091).
- `apps/web/src/lib/shortcuts.ts` — command palette + help, derived from `NAV`.

## Data model, RPCs & migrations
Core reads, it does not own, these tables (see [data-model.md](data-model.md) · [security-rls.md](security-rls.md)):
- `orgs`, `memberships(user_id, org_id, role, permissions)` — tenancy + role; `is_member(org_id)` backs RLS, `has_role`/`has_any_role` back role-aware policies.
- `shops(org_id, is_primary, gstin, state_code, …)` — the active-shop list; the switcher resolves these and self-heals a primary.
- Provisioning RPCs: `create_org`, `redeem_invite` (onboarding paths). The active-shop switch is **client-only** (localStorage) — **no migration**.

## Decisions & gotchas
- **Active shop ≠ primary shop.** The switcher sets a per-session context and deliberately does not touch `is_primary` (the org-wide default, set in Settings → Shops, SALT-090). Persisted per-org in `localStorage`, with the primary as the always-available fallback.
- **One capability source.** Route visibility (nav) and route access (guard) both derive from `lib/permissions`, so they cannot disagree. `counter` ("/") is always permitted — it is the safe redirect target, preventing guard loops.
- **`loading` must clear on every path.** `onAuthStateChange` re-fires on tab focus / token refresh with the *same* user; the gate is only touched when the user actually changes, so refocus never strands the app on "Loading…".
- **Storage is best-effort.** All `localStorage` reads/writes (idle clock, active shop) are wrapped — private-mode / disabled storage degrades gracefully, never throws.

## Current state vs planned
- **Shipped:** per-session shop-switcher (SALT-173); session context with idle-logout (115), MFA (113), recovery (114); capability-gated routing + nav (on the settings-lane roles model, SALT-091).
- **Planned / elsewhere:** real-time/multi-counter substrate is the **realtime** module ([realtime.md](realtime.md)); offline-first session/caching is [offline-first.md](offline-first.md); Google Workspace SSO is the **auth** module (SALT-117). A cross-shop *umbrella* (central stock, HQ dashboard) is a future-tier item, not core.

## Related
[screens-routing.md](screens-routing.md) · [security-rls.md](security-rls.md) · [interaction-patterns.md](interaction-patterns.md) · [data-model.md](data-model.md) · [realtime.md](realtime.md) · [../../CLAUDE.md](../../CLAUDE.md)
