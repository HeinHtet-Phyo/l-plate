---
description: Pull teammates' work safely, resolve context-file conflicts, and summarise what changed
---

# /sync: pull teammates' work

1. Run `git status -sb` and record `BEFORE=$(git rev-parse HEAD)`.
2. If there are uncommitted changes, stash them: `git stash push -u -m "sync $(date +%H%M)"`.
3. Run `git pull --rebase`.
4. **Resolve conflicts** with these rules:
   - **`HANDOFF.md`**: keep every lane. Take *their* version of other people's lanes and *yours* for your own lane.
     In shared sections (Snapshot, Up next, Blockers) keep both edits. Never drop anyone's lane content.
   - **`docs/DECISIONS.md`, `docs/MODEL_FAILURES.md`**: `.gitattributes` sets `merge=union`, so these should merge
     by themselves. If conflict markers appear anyway, keep both entries in time order.
   - **`docs/sessions/*`**: one file per session, so these shouldn't conflict. If they do, keep both.
   - **Code**: resolve it if both intents are clear from the diffs and commit messages. Otherwise run `git rebase --abort`
     and tell the human which teammate's commit conflicts (`git log -1 --format='%an %s' <sha>`) so they can talk.
   - After each resolution, run `git add <file> && git rebase --continue`.
5. If you stashed, run `git stash pop`, resolve any conflicts with the same rules, and `git stash drop` if needed.
6. **Summarise what changed** since `$BEFORE`:
   - `git log --oneline $BEFORE..HEAD --format='%h %an %s'`
   - new files in `docs/sessions/`, plus changes to `HANDOFF.md` lanes, `docs/PROJECT.md`, `DECISIONS.md` and `MODEL_FAILURES.md`
   - **anything that affects your current task**: files you're editing, changed interfaces or env vars, and new dependencies.
     If `package.json`, `pyproject.toml`, `uv.lock` or `requirements*.txt` changed, reinstall.
7. Push only if you have local commits and the human expects it. Otherwise just report.
