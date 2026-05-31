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

## Working in parallel (multiple chats)

Run several Claude Code chats at once **without** messy branches or wasted tokens. The rule: **1 module = 1 worktree = 1 chat = 1 branch = 1 PR.** Spin up with `scripts/wt.sh new <slug>`; never run two chats in the same directory (one dir holds one branch — that is the mess). Two payoffs: disjoint PRs merge for free (git does it — Claude only spends tokens on *conflicts*, never on clean merges), and each chat loads a fraction of the context.

**Scope each chat to its module.** Start by reading `CLAUDE.md` + `wiki/index.md` + *your module's* wiki page(s) below — not the whole codebase. To reach into another module, read *its* wiki page, not its source.

| Chat / module | Read first (its context) | Owns (paths under `apps/web/src` unless noted) |
|---|---|---|
| Billing / Counter | `architecture/billing-screen`, `domain/orders` | `components/billing/**`, `store/bill.ts`, `store/catalog.ts`, `data/catalog.ts`, `lib/billing.ts`, `lib/orders.ts`, `lib/search.ts` |
| Parties | `domain/parties`, `decisions/0010` | `components/parties/**`, `lib/classifyParties.ts`, `lib/mergeSuggest.ts` |
| Bills (history/view) | `domain/orders` | `components/bills/**` |
| Smart Import | `architecture/import-pipeline`, `architecture/smart-import-extension`, `architecture/marg-import-map`, `domain/marg-export-guide` | `components/import/**`, `lib/smart*.ts`, `lib/import.ts` |
| Migrator (Go) | `salt-migrator-prd-v0.1.md`, `architecture/import-pipeline` | `migrator/**` (repo root) |
| Owner dashboard | `product/product-modules` (Reports), `architecture/information-architecture` | `components/owner/**` |
| Nav / routing / IA | `architecture/information-architecture`, `architecture/screens-routing` | `components/nav/**`, `App.tsx` |
| Settings | — | `components/settings/**`, `lib/useShopBlockers.ts` |
| Auth | `architecture/security-rls` | `components/auth/**`, `lib/auth.tsx` |
| Database / model | `architecture/data-model`, `architecture/proposed-data-model`, `architecture/schema`, `architecture/security-rls` | `supabase/migrations/**` (repo root) |
| Design system / UI | `architecture/design-system`, `design.md` | `components/ui/**`, `index.css` |
| Wiki / docs | this section + the wiki schema below | `wiki/**` (repo root) |

New modules from [`wiki/product/product-modules.md`](wiki/product/product-modules.md) — GRN/Purchase, Payments, Returns, GST — get a row when work starts.

**Shared / hot files — the only real conflict surface. Coordinate or serialize:**
- `supabase/migrations/NNNN_*.sql` — claim the next number up front; reserve ranges if two DB chats run (we already did 0014–0024). On collision, just renumber the file in git — don't make Claude reason about it.
- `wiki/index.md`, `wiki/log.md` — append-only; do wiki edits in one chat, or accept the trivial append-conflict.
- `lib/supabase.ts`, `lib/currency.ts`, `lib/utils.ts`, `lib/types.ts` — shared primitives everyone imports; edit solo.
- `App.tsx` + nav, `components/ui/**`, `index.css` (tokens) — central; if your task must touch one, run it solo or merge that PR first.
- `pnpm-lock.yaml`, `package.json`, `apps/web/package.json` — regenerate via `pnpm install` after rebase; never hand-merge the lockfile.

**Module locks (enforced) — two chats can never work the same module.** A `PreToolUse` hook (`.claude/settings.json` → `scripts/hooks/guard-edit.sh`) runs before every `Edit`/`Write`/`MultiEdit`. It maps the file to its module via [`scripts/module-map.txt`](scripts/module-map.txt) and, the first time your chat edits a module, **auto-claims** an exclusive lock on it. If another chat already holds that module, the edit is **refused by the harness** — you cannot silently collide. You hold a module until you give it up.
- `scripts/wt.sh claim <module…>` — reserve a module up front, before editing, so others see it immediately (also auto-claimed by `wt.sh new <module>` when the worktree is named for a module).
- `scripts/wt.sh release <module…>` — give it up when done; or merge the PR and `wt.sh rm <slug>`, which releases all of that worktree's locks.
- `scripts/wt.sh locks` — see who holds what; a lock whose worktree is gone shows `STALE` and is auto-reclaimed on the next claim.
- Blocked? Pick a different module, or have the holder `release` it (a human can `release <module> --force`).
- Caveats: only `Edit/Write/MultiEdit` are guarded — don't hand-write files via `Bash` to dodge a lock. Unmapped files (configs, docs) are never blocked. The module table above mirrors `scripts/module-map.txt` — edit both.

**Coordinating dependencies — the work queue.** `scripts/wt.sh queue` shows a shared board (`../salt-worktrees/queue.md`, **not** in git, instant across worktrees on this machine). Post with `scripts/wt.sh post "<msg>"`, tagged:
- `BLOCK: <what you need>` — before a dependent task, post the exact need (RPC name + signature, table, migration number) and tell the user you are blocked. Do not guess the interface.
- `DONE: <what landed> (#PR)` — the producing chat posts on merge, naming the concrete artifact, **and** updates its module's wiki page so the contract is durable, not just in the queue.
- `NOTE:` / `CLAIM:` — anything else worth other chats seeing; `CLAIM` is auto-posted by `wt.sh new`.
- When unblocked, run `scripts/wt.sh queue`, then `git fetch origin && git rebase origin/main`, then proceed — no re-explanation needed.

**Vertical features that cross modules** (e.g. persisting sales = Database + Billing): either one chat owns the slice and reads both wiki pages, or split it — the Database chat ships the migration + RPC and posts `DONE` first, then the Billing chat consumes it. Don't run both halves at once.

**Merge / rebase discipline (keeps tokens near zero):** merge independent PRs in any order (squash on GitHub); after any merge, `git fetch origin && git rebase origin/main` in every other worktree (disjoint = conflict-free). Let GitHub merge and git rebase — only ask Claude to resolve a conflict you could not avoid.

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
