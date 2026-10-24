---
name: decision
description: Log a team decision in docs/DECISIONS.md (append-only) and push it
argument-hint: "<what was decided>"
---

# /decision: log a decision

Decision: $ARGUMENTS

1. Run `git pull --rebase`. Decisions affect everyone, so start from the latest file.
2. Append an entry at the **bottom** of `docs/DECISIONS.md`, using the format at the top of that file. Get the
   timestamp from `date '+%Y-%m-%d %H:%M'`. End the entry with a blank line.
   - Fill **Why** and **Alternatives** from the conversation. Ask the human only if the reason is genuinely unknown.
   - If it replaces an earlier decision, add `- **Supersedes:** <that entry's title>`. Don't edit the old entry.
3. If it changes the idea, scope, stack, models, env vars or layout, update `docs/PROJECT.md` to match.
4. Commit and push now rather than at handoff:
   ```bash
   git add docs/DECISIONS.md docs/PROJECT.md
   git commit -m "docs(decision): <short title>"
   git push || (git pull --rebase && git push)
   ```
