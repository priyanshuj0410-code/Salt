---
type: architecture
updated: 2026-06-02
---

# Auth module

Everything between an anonymous browser and an authenticated, org-scoped session: sign-in (email, Google, phone OTP), onboarding, session lifecycle, MFA, password recovery, and role-based route gating. The React client talks to Postgres directly via PostgREST, so the **database (RLS) is the real security boundary** — see [security-rls.md](security-rls.md). This page covers the **client** auth surface; tenancy/RLS lives there.

Backed by **Supabase Auth (GoTrue)**; the client holds a JWT (per [decisions/0001-supabase-as-backend.md](../decisions/0001-supabase-as-backend.md)).

## Surface (files)

Under `apps/web/src/components/auth/` plus the provider `apps/web/src/lib/auth.tsx`:

| File | Role |
|---|---|
| `lib/auth.tsx` | `AuthProvider` + `useAuth()`: session bootstrap, membership/role + permission overrides, active-shop, and the three global overlays (idle / recovery / MFA). |
| `LoginPage.tsx` | Sign-in hub — modes `signin` / `signup` / `reset` / `phone`, plus Google OAuth. |
| `OnboardingPage.tsx` | Create-org or join-with-code after first sign-in (signed in, no membership yet). |
| `ProtectedRoute.tsx` | Route guard: redirect to `/login` (no session), `/onboarding` (no membership), `/` (role not allowed). |
| `UserMenu.tsx` | Header identity + owner links (Import / Owner view / Two-factor). |
| `PhoneLogin.tsx` | Phone + SMS OTP two-step flow. |
| `IdleWarningDialog.tsx` | Non-blocking idle-logout countdown banner. |
| `UpdatePasswordDialog.tsx` | Set-new-password modal (recovery). |
| `MfaChallengeDialog.tsx` | Login TOTP challenge (blocks until aal2). |
| `MfaSetupDialog.tsx` | TOTP enroll / manage (owner). |

The overlays are mounted **inside `AuthProvider`** (not via routes), so they appear app-wide on any authenticated screen without touching `App.tsx` (the `nav` module).

## What shipped

### Sign-in methods — `LoginPage`
- **Email + password** — `signInWithPassword` / `signUp`; signup prompts for email confirmation, with a **Resend** action (SALT-114).
- **Google OAuth** — `signInWithOAuth({ provider: "google" })`.
- **Phone + OTP** (SALT-112) — `PhoneLogin`: number → `signInWithOtp({ phone })` → 6-digit code → `verifyOtp({ type: "sms" })`. Numbers normalize to E.164 client-side (bare 10-digit assumed Indian → `+91`; a leading `0` is dropped). Resend / change-number supported.

### Session timeout (SALT-115)
Idle auto-logout for shared counter terminals. `AuthProvider` tracks pointer/keyboard/touch/scroll/visibility; after `IDLE_MS` (default 30 min, override `VITE_SESSION_IDLE_MINUTES`) it signs out and routes to `/login` with a one-time "signed out due to inactivity" notice. A non-blocking countdown banner shows in the final 60s with **Stay signed in**. Last-activity is shared across tabs via `localStorage`, so an idle background tab cannot log out an active one. The timer is keyed on the **user id** (not the session object) so a token refresh / tab refocus does not reset it; it is fully torn down on sign-out.

### Password reset + email verification (SALT-114)
"Forgot password?" → `resetPasswordForEmail` (redirect back to the app). Returning via the link fires the `PASSWORD_RECOVERY` event, which `AuthProvider` surfaces as an app-wide `UpdatePasswordDialog` (validates length ≥ 8 + confirmation match → `updateUser`). Cancelling signs out the temporary recovery session.

### MFA for owners (SALT-113)
TOTP. Owners enable it from `UserMenu` → `MfaSetupDialog` (`mfa.enroll` → QR + secret → `mfa.challengeAndVerify`); they can turn it off (`mfa.unenroll`, pruning unverified factors). At login, `AuthProvider` reads `getAuthenticatorAssuranceLevel()`; if a verified factor exists but the session is `aal1` (`nextLevel === "aal2"`) it blocks the app behind `MfaChallengeDialog` until a valid code elevates to `aal2`. Cancel = sign out, so MFA cannot be bypassed.

### Role-based route guards (SALT-116)
`App.tsx` wraps owner-only routes in `ProtectedRoute allowedRoles={["owner"]}` and the component redirects non-owners to `/`. **This is UI-level only.** RLS is org-level (`is_member`), not role-aware, so a cashier could still reach owner data via direct PostgREST — that residual is tracked in **SALT-199** (role-aware RLS, `database` module). See [security-rls.md](security-rls.md).

### Design tokens (SALT-228)
Auth screens use canonical design tokens (`text-text-tertiary`, `bg-surface-2`, …) — no legacy `text-muted-foreground` / `bg-muted` / `zinc-*`. Part of the SALT-147 consistency pass; see [design-system.md](design-system.md).

## Data model

No migrations were added by these six tickets — all are **client-side** on existing tables (auth is enforced in the DB via RLS, documented in [security-rls.md](security-rls.md)).

- **`memberships(user_id, org_id, role, permissions)`** — a user's org + role (`owner` | `manager` | `accountant` | `pharmacist` | `cashier`) plus per-user permission overrides. `useAuth().membership` loads the first row (falls back to the pre-`permissions` columns if that migration is not yet applied).
- **`orgs`**, **`shops`** — org and its shops (the active-shop switcher is a separate concern, SALT-173).
- Security-definer RPCs `create_org`, `redeem_invite` back onboarding; `is_member(org_id)` backs every RLS policy.
- MFA factors and the session `aal` live in Supabase Auth (GoTrue), not in app tables.

## Decisions & gotchas

- **Overlays live in `AuthProvider`**, props-driven, so idle/recovery/MFA prompts render on every authenticated screen with no new routes and no `nav`-module change.
- **Idle timer keyed on user id**, not the session object, so token refresh / refocus does not reset the clock.
- **React Compiler lint is strict** here: no synchronous `setState` in an effect body (defer via the `.then` / microtask pattern), and no impure calls (`Date.now()`) during render (init refs to `0`, set inside the effect).
- **Config, not DB**: the idle window is an env var; a per-org configurable timeout is a follow-up (needs `settings` + `database`).
- **Provider-dependent / not locally verifiable**: phone OTP (SMS), recovery email, and MFA require Supabase project config (SMS provider / SMTP / MFA enabled). The flows and pure helpers are smoke-tested; the round-trips need a live project.

## Current vs planned

**Shipped:** SALT-112 (phone OTP) · SALT-113 (MFA) · SALT-114 (reset + verify) · SALT-115 (idle timeout) · SALT-116 (route guards) · SALT-228 (token cleanup).

**Open / planned:**
- **SALT-117** — Google Workspace SSO. Basic Google OAuth already exists; true Workspace SSO means per-org SAML/OIDC (`signInWithSSO` + an enterprise IdP), not a client-only build.
- **SALT-199** — role-aware RLS (the real enforcement behind SALT-116), in the `database` module.
- Per-org configurable idle timeout; absolute max-session lifetime; a mandatory-MFA-for-owners rollout policy.

Per `salt-prd-v0.3.md` §5.4 (role-based access, MFA for owners, audit log).

## Related
[security-rls.md](security-rls.md) · [data-model.md](data-model.md) · [screens-routing.md](screens-routing.md) · [design-system.md](design-system.md) · [decisions/0004-strict-rls-isolation.md](../decisions/0004-strict-rls-isolation.md)
