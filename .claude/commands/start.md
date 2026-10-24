---
description: Start a session. Load team context, sync with teammates, then pick and claim a task
argument-hint: "[what you want to work on]"
---

# /start: begin a session

Goal: know exactly where the project was left off **before** touching anything.
(Not on Claude Code? `$ARGUMENTS` means whatever your human asked to work on, if anything.)

1. **Who am I.** Run `git config user.name` and `gh api user --jq .login 2>/dev/null`. Match the result to a lane in
   `HANDOFF.md` (lanes use GitHub handles). If nothing matches, ask the human for their handle.
2. **Sync.** Run `git status -sb` and `git fetch --quiet`.
   - Behind with a clean tree: `git pull --rebase`.
   - Behind with local changes: follow `.claude/commands/sync.md`.
3. **Read**, in order: `AGENTS.md` (skip if it's already in context), `HANDOFF.md`, `docs/PROJECT.md`,
   the 3 newest `docs/sessions/*.md` (excluding README), and the last ~5 entries of `docs/DECISIONS.md`
   and `docs/MODEL_FAILURES.md`. Also run `git log --oneline -10 --format='%h %an %ar %s'`.
4. **Brief the human** in 12 lines or fewer:
   - The project in one line, plus the time left until judging at 16:30 (check `date`).
   - What works end-to-end right now.
   - Who's on what, from the lanes. Flag lanes not updated in over 90 minutes as possibly stale.
   - **Your lane:** what you left off at and its next steps.
   - Unclaimed tasks and blockers.
   - **Drift:** anything in the docs that the code or `git log` contradicts.
5. **Pick the work.**
   - If `$ARGUMENTS` is given, check nobody else has it. Look at the lanes and the active branches
     (`git branch -r --sort=-committerdate | head`). If someone does, tell the human who.
   - Otherwise propose 1–3 tasks from your lane's "Next" or from "Up next" and let the human choose.
6. **Claim it** by following `.claude/commands/claim.md`, which commits and pushes the claim.

Don't start coding before step 6 unless the human says to skip it.
