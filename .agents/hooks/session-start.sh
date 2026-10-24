#!/usr/bin/env bash
# Session-start context for ANY coding agent: prints where the team left off (git sync status, recent commits,
# the latest HANDOFF.md from origin, the newest session logs).
#   Claude Code: .claude/settings.json runs this on SessionStart; plain stdout is added to context.
#   Cursor:      .cursor/hooks.json runs it with --format cursor; it prints {"additional_context": "..."}.
#   Anything else: run `bash .agents/hooks/session-start.sh` yourself at the start of a session (AGENTS.md §1).
# Best-effort by design: it must never fail or stall a session, so every step tolerates errors.

format=text
[ "$1" = "--format" ] && format=${2:-text}

# Cursor can also run Claude Code's hooks; only answer the Cursor-format call there so context isn't injected twice.
if [ -n "$CURSOR_VERSION" ] && [ "$format" != cursor ]; then exit 0; fi

cd "${CURSOR_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

context() {
  # Fetch so "behind" counts and HANDOFF.md reflect what teammates pushed; give up after ~3s (offline, slow network).
  GIT_TERMINAL_PROMPT=0 git fetch --quiet origin >/dev/null 2>&1 &
  fetch_pid=$!
  for _ in 1 2 3 4 5 6; do kill -0 "$fetch_pid" 2>/dev/null || break; sleep 0.5; done
  kill "$fetch_pid" 2>/dev/null

  branch=$(git branch --show-current 2>/dev/null)
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)

  echo "## Team context (auto-loaded by .agents/hooks/session-start.sh)"
  echo
  echo "Now: $(date '+%Y-%m-%d %H:%M %Z') · Branch: ${branch:-detached} · You: $(git config user.name 2>/dev/null)"

  if [ -n "$upstream" ]; then
    counts=$(git rev-list --left-right --count "$upstream...HEAD" 2>/dev/null)
    behind=${counts%%[[:space:]]*}
    ahead=${counts##*[[:space:]]}
    echo "vs $upstream: ${behind:-?} behind, ${ahead:-?} ahead"
    if [ "${behind:-0}" -gt 0 ] 2>/dev/null; then
      echo "WARNING: teammates pushed ${behind} commit(s) you don't have. Run \`git pull --rebase\` (or the sync skill) before editing anything."
    fi
  fi

  dirty=$(git status --short 2>/dev/null | head -15)
  if [ -n "$dirty" ]; then
    echo
    echo "Uncommitted changes (first 15):"
    echo "$dirty"
  fi

  ref=${upstream:-HEAD}
  echo
  echo "### Recent commits ($ref)"
  git log "$ref" -8 --format='%h  %an, %ar: %s' 2>/dev/null

  # Show the team's latest board: from origin when it exists there (current even before you pull), else the local file.
  echo
  if [ -n "$upstream" ] && git cat-file -e "$upstream:HANDOFF.md" 2>/dev/null; then
    echo "### HANDOFF.md (from $upstream)"
    git show "$upstream:HANDOFF.md" 2>/dev/null | head -n 160
  elif [ -f HANDOFF.md ]; then
    echo "### HANDOFF.md (local)"
    head -n 160 HANDOFF.md
  fi

  echo
  echo "### Newest session logs (read these before building)"
  git ls-tree -r --name-only "$ref" -- docs/sessions/ 2>/dev/null | grep -v '/README.md$' | sort | tail -n 3 | sed 's/^/- /'

  echo
  echo "Protocol: follow AGENTS.md. Read docs/PROJECT.md and the logs above, claim before building (/claim), log decisions and model failures as they happen, hand off before stopping (/handoff). Workflows are skills in .agents/skills/."
}

if [ "$format" = cursor ]; then
  context | python3 -c 'import json,sys; print(json.dumps({"additional_context": sys.stdin.read()}))' 2>/dev/null \
    || echo '{}'
else
  context
fi
exit 0
