---
description: Read-only team status. Who's on what, what's unclaimed, what's blocked or stale
---

# /board: team status (read-only)

Don't edit any files.

1. Run `git fetch --quiet`. Read the board from origin so it's current even if you haven't pulled:
   `git show @{u}:HANDOFF.md` (fall back to the local `HANDOFF.md` if there's no upstream).
2. Gather activity:
   - `git log @{u} -10 --format='%h %an %ar %s'`
   - `git branch -r --sort=-committerdate --format='%(refname:short)  %(committerdate:relative)  %(authorname)' | head`
3. Print:
   - A table with the columns **teammate | status | working on | updated | branch**.
   - Unclaimed tasks, then blockers and open questions.
   - **Stale:** lanes "in progress" with no update in over 90 minutes, or a lane that contradicts recent commits.
   - Time left until judging at 16:30 (check `date`), and whether "Works end-to-end" is still "nothing".
4. Suggest the single most useful next action for the team, if one stands out.
