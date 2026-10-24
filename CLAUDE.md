@AGENTS.md

## Claude Code specifics

- A **SessionStart hook** (`.claude/hooks/session-start.sh`) runs on startup, resume, `/clear` and after compaction.
  It injects your git sync status (fetched first), recent team commits, the **latest `HANDOFF.md` from origin**,
  and the newest session-log filenames. That is a summary only: still read `docs/PROJECT.md` and those logs before you build.
- **Commands:** `/start`, `/claim`, `/sync`, `/board`, `/decision`, `/log-failure`, `/handoff` (in `.claude/commands/`).
- **Skills:** `project-memory` (when and how to write things down), `token-factory` (any LLM call),
  `demo-prep` (demo, pitch, judging), plus the Tavily web-search skills in `.claude/skills/`.
- Your personal auto-memory lives only on this laptop, so teammates can't see it. Anything the team needs goes in
  the repo files listed in AGENTS.md, not only in memory.
- When the user says they're done, taking a break, or the context is getting long, offer `/handoff`.
