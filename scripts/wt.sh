#!/usr/bin/env bash
#
# wt.sh — git worktrees + a shared work queue for parallel Claude Code chats on Salt.
# One module = one worktree = one chat = one branch = one PR.
# See CLAUDE.md > "Working in parallel" for the full workflow and module map.
#
set -euo pipefail

# The main checkout is always the first entry of `git worktree list`, so these
# paths are identical whether you run this from the main repo or from a worktree.
MAIN_REPO="$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)"
WT_HOME="$(dirname "$MAIN_REPO")/salt-worktrees"
QUEUE="$WT_HOME/queue.md"

# Files git ignores that a fresh worktree needs to run the app / avoid re-prompts.
CARRY=(
  "apps/web/.env.local"
  ".claude/settings.local.json"
)

ensure_queue() {
  mkdir -p "$WT_HOME"
  [ -f "$QUEUE" ] || printf '# Salt work queue — shared across worktrees, NOT in git. Append-only. Tags: CLAIM / BLOCK / DONE / NOTE.\n' > "$QUEUE"
}

# Which chat is posting? The worktree folder name, else "main".
current_slug() {
  case "$PWD/" in
    "$WT_HOME"/*) basename "$PWD" ;;
    *) echo "main" ;;
  esac
}

# append_line <slug> <message...>  (one short line; >> append is atomic, no lock needed)
append_line() {
  local slug="$1"; shift
  ensure_queue
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M')" "$slug" "$*" >> "$QUEUE"
}

cmd_new() {
  local slug="${1:?usage: wt.sh new <slug> [base]}"
  local base="${2:-origin/main}"
  local dir="$WT_HOME/$slug"

  git -C "$MAIN_REPO" fetch origin --quiet || true
  git -C "$MAIN_REPO" worktree add -b "$slug" "$dir" "$base"

  local f
  for f in "${CARRY[@]}"; do
    if [ -f "$MAIN_REPO/$f" ]; then
      mkdir -p "$dir/$(dirname "$f")"
      cp "$MAIN_REPO/$f" "$dir/$f" 2>/dev/null || true
    fi
  done

  ( cd "$dir" && pnpm install )
  append_line "$slug" "CLAIM: created worktree (base $base)"

  cat <<EOF

Worktree ready: $dir
  Open a chat there:   cd "$dir" && claude
  First read:          CLAUDE.md > "Working in parallel" (the '$slug' row) + wiki/index.md + your module's wiki page
  Check the queue:     scripts/wt.sh queue
EOF
}

cmd_list() { git -C "$MAIN_REPO" worktree list; }

cmd_rm() {
  local slug="${1:?usage: wt.sh rm <slug>}"
  git -C "$MAIN_REPO" worktree remove "$WT_HOME/$slug"
  git -C "$MAIN_REPO" worktree prune
  append_line "$slug" "DONE: removed worktree"
  echo "Removed $WT_HOME/$slug (branch '$slug' kept; delete with: git branch -D $slug)"
}

cmd_queue() { ensure_queue; tail -n "${1:-40}" "$QUEUE"; }

cmd_post() {
  [ "$#" -ge 1 ] || { echo "usage: wt.sh post <message>   (prefix BLOCK:/DONE:/NOTE:)" >&2; exit 1; }
  append_line "$(current_slug)" "$*"
}

usage() {
  cat <<'EOF'
wt.sh — parallel-chat worktrees + work queue (see CLAUDE.md > "Working in parallel")

  wt.sh new <slug> [base]   create worktree+branch (base defaults to origin/main),
                            copy gitignored env/settings, pnpm install, post CLAIM
  wt.sh list                list worktrees
  wt.sh rm <slug>           remove a worktree (keeps the branch), post DONE
  wt.sh queue [N]           show the last N queue lines (default 40)
  wt.sh post <message>      append a queue line; prefix with BLOCK: / DONE: / NOTE:
EOF
}

case "${1:-}" in
  new)   shift; cmd_new "$@" ;;
  list)  shift; cmd_list "$@" ;;
  rm)    shift; cmd_rm "$@" ;;
  queue) shift; cmd_queue "$@" ;;
  post)  shift; cmd_post "$@" ;;
  ""|-h|--help|help) usage ;;
  *) echo "wt.sh: unknown command '$1'" >&2; usage; exit 1 ;;
esac
