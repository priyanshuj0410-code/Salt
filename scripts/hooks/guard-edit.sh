#!/usr/bin/env bash
#
# guard-edit.sh — Claude Code PreToolUse hook (wired in .claude/settings.json).
# Blocks an Edit/Write/MultiEdit when the target file belongs to a module that
# another chat (worktree) holds a lock on. The lock decision lives in wt.sh.
#
# FAIL-OPEN: any missing dependency, empty field, unmapped file, or error allows
# the edit. A bug in this hook must never block all editing.
#
# Input  : the tool call as JSON on stdin (.tool_name, .tool_input.file_path, .cwd)
# Output : nothing + exit 0 to allow; a deny JSON on stdout to block.
# See CLAUDE.md > "Working in parallel".

input="$(cat 2>/dev/null)" || exit 0
command -v jq >/dev/null 2>&1 || exit 0

tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)" || exit 0
case "$tool" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)" || exit 0
[ -n "$file" ] || exit 0

proj="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$proj" ]; then
  proj="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)" || exit 0
fi
[ -n "$proj" ] || exit 0

rel="${file#"$proj"/}"
[ "$rel" != "$file" ] || exit 0          # file is outside the project root -> allow

map="$proj/scripts/module-map.txt"
wt="$proj/scripts/wt.sh"
[ -f "$map" ] || exit 0
[ -f "$wt" ] || exit 0

# Resolve the module: first row whose glob prefixes (dir/) or equals (file) rel.
module="$(awk -v p="$rel" '
  /^#/ || NF == 0 { next }
  {
    for (i = 2; i <= NF; i++) {
      g = $i
      if (substr(g, length(g)) == "/") { if (index(p, g) == 1) { print $1; exit } }
      else { if (p == g) { print $1; exit } }
    }
  }' "$map" 2>/dev/null)" || exit 0
[ -n "$module" ] || exit 0               # file belongs to no module -> allow

# Delegate to wt.sh (run inside the project so the chat's slug resolves correctly).
# exit 0 = we hold (or just auto-claimed) the lock; non-zero = held by another chat.
if reason="$(cd "$proj" && bash "$wt" guard-claim "$module" 2>/dev/null)"; then
  exit 0
fi

[ -n "$reason" ] || reason="module '$module' is locked by another chat"
jq -n --arg r "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $r}}' \
  2>/dev/null || { echo "$reason" >&2; exit 2; }
exit 0
