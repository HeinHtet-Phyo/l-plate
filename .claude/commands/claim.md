---
description: Claim a task in HANDOFF.md and push right away so teammates' agents don't duplicate it
argument-hint: "<task>"
---

# /claim: claim a task

Task to claim: $ARGUMENTS

1. **Get the latest board.** On a clean tree, run `git pull --rebase`. On a dirty tree, run
   `git stash push -u -m claim && git pull --rebase && git stash pop`.
2. **Check it's free.** If the task already sits in someone else's lane under "Working on", stop and tell the human
   who has it. Suggest pairing or a neighbouring task.
3. **Edit `HANDOFF.md`**:
   - If the task is listed under "Up next", delete that line.
   - In **your lane**, set **Status** to `in progress`, **Working on** to the task (one line, concrete),
     **Branch** to the branch you'll use, and **Updated** to the output of `date '+%Y-%m-%d %H:%M'`.
   - Update the `Last updated:` line at the top.
4. **Commit only `HANDOFF.md`, then push:**
   ```bash
   git commit -m "chore(handoff): @<handle> claims <task>" -- HANDOFF.md
   git push || (git pull --rebase && git push)
   ```
   If the rebase conflicts in `HANDOFF.md`, keep everyone's lanes (see `.claude/commands/sync.md`).
5. Tell the human the claim is pushed, then start the work.
