# Salt — Claude Code project guide

Salt is a **cloud-first ERP for Indian medical retail** (chemists, surgicals, ayurveda) — a modern, multi-shop, real-time replacement for Marg/Tally. This file is the contract for how to work in this repo and how to maintain the knowledge wiki. Read it at the start of every session.

## What this repo is

- Monorepo: pnpm workspaces + Turborepo. The app is `apps/web` (Vite + React 18 + TypeScript + Tailwind v4 + shadcn/ui "base-nova" on `@base-ui/react`).
- **Supabase is the backend** (not "no backend"): Postgres, PostgREST auto REST, Auth (GoTrue), Row-Level Security, Postgres functions/RPCs, triggers. Edge Functions / Storage / pg_cron are available but largely unused so far.
- `migrator/` is a separate Go tool that reads Marg DBF files and uploads via an RPC.
- Deployed on Vercel (`salt-pharma.vercel.app`) from `main`. CI = "Lint, Typecheck & Build" on PRs to `main`.

## How to work here

- **Verify before shipping:** `cd apps/web && pnpm lint && pnpm build` (build runs `tsc -b` then Vite). Pure logic gets a throwaway `node smoke-*.ts` (Node 25 strips TS types); delete the smoke file after.
- **Migrations** live in `supabase/migrations/NNNN_*.sql` and are **run by the user** in the Supabase SQL editor — never auto-applied. When you add one, tell the user to run it.
- **Money is integer paise** everywhere (`*_paise` columns, `bigint` for balances). Format with `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`.
- **PR workflow:** branch → commit → push → open PR → the user merges (they say "merge"). Squash-merge. Stacked PRs need rebasing onto `main` after the parent merges (don't `--delete-branch` a base that other PRs stack on — it closes them).
- **Never commit** `Saral/` (real customer trial balance) or `*.pdf` PRDs. They are untracked on purpose.
- **Secrets:** only the Supabase publishable/anon key is used client-side (safe). Never the service-role key or DB password.
- Commit messages: no apostrophes in heredocs (they break the shell); run commit and push as separate commands.

## Working in parallel — via projectkit

Coordination for this project is centralized in **projectkit** — the device-wide local-Jira board (`/jira`), with its tickets, work queue, and module locks shown across every project. This repo intentionally carries **no custom `scripts/wt.sh`, work queue, or lock hook**; everything flows through projectkit rather than per-repo tooling. To enable in-repo worktree + lock tooling (the `wt.sh` / ticket commands the projectkit skills drive), adopt this repo through the projectkit scaffolder.

## The knowledge wiki (`wiki/`)

This repo follows the **LLM Wiki pattern** (Karpathy): a persistent, LLM-maintained knowledge base so context compounds across sessions instead of being re-derived. You (the LLM) own and maintain it; the human curates and asks questions.

**Three layers**
1. **Raw sources** (immutable): the PRDs and design docs at repo root — `salt-prd-v0.3.md`, `salt-migrator-prd-v0.1.md`, `design.md`, `salt-design-system.html`, `PRD_Intelligent_Importer.pdf` — plus the codebase itself. Read from these; never rewrite them.
2. **The wiki** (`wiki/`): LLM-generated, interlinked markdown. You create and update these pages.
3. **The schema** (this file): conventions + workflows below.

**Layout**
```
wiki/
  index.md        catalog of every page (link + one-liner), grouped by section
  log.md          append-only timeline; entries: ## [YYYY-MM-DD] type | title
  overview.md     the living synthesis of the project
  product/        PRD vision, goals, roadmap, current-vs-planned
  architecture/   stack, data-model, security-rls, import-pipeline, design-system
  domain/         pharma-retail glossary, trial-balance format, parties identity
  decisions/      ADR-style records: NNNN-title.md
```

**Page conventions**
- Light YAML frontmatter: `type`, `updated` (and optional `tags`).
- Link between pages with relative markdown links — e.g. a `domain/` page links up to `../architecture/data-model.md` — so they render on GitHub *and* in Obsidian.
- Concise synthesis over transcription. Flag contradictions (e.g. PRD-vs-as-built) explicitly rather than hiding them.
- Cite the raw source when a claim comes from one (e.g. "per `salt-prd-v0.3.md` §6.2").

**Operations** (the human will ask for these)
- **Ingest:** when given a new source or after building a feature, read it, update the relevant pages (architecture / domain / decisions / overview), refresh `index.md`, and append a `log.md` entry. One change may touch several pages.
- **Query:** to answer a question, read `index.md` first, drill into the relevant pages, synthesize with citations. Good answers worth keeping get filed back as a new page.
- **Lint:** on request, health-check the wiki — contradictions, stale claims, orphan pages, missing cross-links, concepts lacking a page.

**Reusable for a personal wiki later:** the conventions above are domain-agnostic. A future personal knowledge base would be a *separate* repo/folder following this same schema (its own `index.md`, `log.md`, page formats) — not mixed into this Salt repo.

## Start-here pointers

- Project synthesis → [wiki/overview.md](wiki/overview.md)
- What exists vs what the PRD plans → [wiki/product/roadmap.md](wiki/product/roadmap.md)
- Data model + migrations → [wiki/architecture/data-model.md](wiki/architecture/data-model.md)
- Why the stack differs from the PRD → [wiki/decisions/0002-stack-divergence-from-prd.md](wiki/decisions/0002-stack-divergence-from-prd.md)
- Running multiple chats in parallel → [Working in parallel](#working-in-parallel-multiple-chats) (use `scripts/wt.sh`)
