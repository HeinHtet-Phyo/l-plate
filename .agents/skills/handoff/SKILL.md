---
name: handoff
description: End-of-session handoff. Write a session log, update your HANDOFF.md lane, commit and push
argument-hint: "[extra notes for the next agent]"
---

# /handoff: leave the project ready for the next agent

Run this before you stop, before a long break, or when the context is getting long or about to be compacted.
**The test:** a fresh agent on another teammate's laptop, maybe in a different tool, with none of this chat, can carry on from the files alone.

Extra notes from the human: $ARGUMENTS

1. **Gather:** `git status -sb`, `git diff --stat`, `git log --oneline @{u}..HEAD`, and what this session did
   (from the conversation). Identify your handle (`git config user.name`, which matches a lane in `HANDOFF.md`).
2. **Write the session log** at `docs/sessions/<YYYY-MM-DD-HHMM>-<handle>-<slug>.md`, using the template in
   `docs/sessions/README.md`. HHMM is roughly when the session started. Be concrete: paths, commands,
   exact errors, model IDs, commit shas. Put the human's extra notes in it.
3. **Update `HANDOFF.md`:**
   - **Your lane:** Status, Working on (`nothing` if you finished), Next (concrete steps), Branch,
     Updated (`date '+%Y-%m-%d %H:%M'`), and Log (the path of the new session file).
   - **Snapshot:** update "Works end-to-end" and any line that is now wrong. Leave the rest alone.
   - **Up next:** add follow-up tasks you found but aren't doing. **Blockers:** add new ones and remove resolved ones.
   - The `Last updated:` line.
   - Keep the file under ~150 lines. Move detail into the session log.
4. **Catch up the logs.** Append any decision from this session that isn't in `docs/DECISIONS.md` yet,
   and any model failure that isn't in `docs/MODEL_FAILURES.md` yet.
5. **`docs/PROJECT.md`:** if the idea, scope, stack, layout, env vars or run/test commands changed, update it.
6. **Commit:**
   - If there are uncommitted code changes, list them and ask the human whether to commit them now (with a proper
     `feat:`/`fix:` message) or leave them out. Don't silently commit half-finished work to `main`. Use a branch
     if it's broken.
   - Check `git diff --cached` for secrets (keys, tokens, `.env`). Abort if you find any.
   - Commit the context files:
     `git add HANDOFF.md docs/ && git commit -m "chore(handoff): @<handle>: <slug>"`
7. **Push:** `git pull --rebase && git push`. Resolve conflicts with the rules in the `sync` skill (`.agents/skills/sync/SKILL.md`).
   If you're on a branch, push it and say whether it's ready to merge.
8. **Tell the human:** a three-line summary, the session log path, and the top next step.
