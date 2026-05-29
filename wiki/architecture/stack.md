---
type: architecture
updated: 2026-05-29
---

# Stack & repo layout

## As-built stack

- **Monorepo:** pnpm workspaces + Turborepo. Root holds `apps/`, `packages/` (empty so far), `migrator/`, `supabase/`, and the raw source docs.
- **App (`apps/web`):** Vite + React 18 + TypeScript. Tailwind **v4** + shadcn/ui ("base-nova" style on `@base-ui/react`). State: **Zustand** (bill, catalog stores). Routing: **react-router-dom v7** with a role-gated `ProtectedRoute`; `SmartImportPage` is lazy-loaded to keep `xlsx` out of the main bundle.
- **Backend: Supabase** — Postgres + PostgREST (auto REST) + Auth (GoTrue) + RLS + Postgres functions/RPCs. The client (`@supabase/supabase-js`) talks to it directly; there is no separate API server.
- **Parsing libs:** `papaparse` (CSV), SheetJS `xlsx` (XLS/XLSX).
- **Migrator (`migrator/`):** standalone Go tool, reads Marg DBF → uploads via `redeem_migration_token` RPC. Cross-compiled to Windows, served from `apps/web/public/downloads/`.
- **Deploy:** Vercel (`salt-pharma.vercel.app`) from `main`; root `vercel.json` sets `outputDirectory: apps/web/dist` + SPA rewrites. CI: GitHub Actions "Lint, Typecheck & Build" on PRs to `main`, plus Vercel preview deploys. Analytics: Vercel Web Analytics + Speed Insights.

## Conventions

- **Money:** integer **paise** everywhere; `*_paise` columns, `bigint` for balances. Display via `Intl.NumberFormat("en-IN", …)`. See [decisions/0003-money-as-paise.md](../decisions/0003-money-as-paise.md).
- **Verification:** `pnpm lint` + `pnpm build` (tsc + Vite). Pure logic verified with throwaway `node smoke-*.ts` (Node 25 type-stripping), deleted after.
- **Migrations:** SQL files in `supabase/migrations/`, run manually by the user in the Supabase SQL editor.

## Relation to the PRD

The PRD (`salt-prd-v0.3.md` §6.2) recommends a heavier stack: **NestJS** API, **ElectricSQL** for offline-first sync, **self-hosted Yjs** for real-time collaboration, **BullMQ/Redis**, and a **shop-local server** mirroring Postgres to SQLite. None of that is built yet — see [decisions/0002-stack-divergence-from-prd.md](../decisions/0002-stack-divergence-from-prd.md). The frontend library choices (React/TS/shadcn/Tailwind/Zustand/TanStack) match the PRD.

## Related

- [data-model.md](data-model.md) · [security-rls.md](security-rls.md) · [design-system.md](design-system.md)
