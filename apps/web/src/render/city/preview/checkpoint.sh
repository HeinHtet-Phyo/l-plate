#!/bin/bash
# Auto-checkpoint the city work to origin/feat/city every N seconds (default 480), so a crash or a usage limit
# in one agent doesn't lose work: any agent/tool can `git pull` the branch and carry on (see ../README.md).
# Run from the repo: bash apps/web/src/render/city/preview/checkpoint.sh [seconds] &
cd "$(git rev-parse --show-toplevel)" || exit 1
INTERVAL=${1:-480}
PATHS="apps/web/src/render/city apps/web/src/render/textures.ts apps/web/src/render/atmosphere/uniforms.ts"
while true; do
  sleep "$INTERVAL"
  [ "$(git branch --show-current)" = "feat/city" ] || continue
  if [ -n "$(git status --porcelain -- $PATHS)" ]; then
    for _ in 1 2 3; do
      git add -- $PATHS 2>/dev/null && git commit -q -m "wip(city): auto-checkpoint $(date +%H:%M) (may not typecheck)" -- $PATHS && break
      sleep 7
    done
  fi
  git push -q origin feat/city 2>/dev/null || true
  echo "checkpoint $(date +%H:%M:%S) $(git log --oneline -1)"
done
