@AGENTS.md

## Claude Code specifics

- A **SessionStart hook** (`.claude/hooks/session-start.sh`) runs on startup, resume, `/clear` and after compaction.
  It injects your git sync status (fetched first), recent team commits, the **latest `HANDOFF.md` from origin**,
  and the newest session-log filenames. That is a summary only: still read `docs/PROJECT.md` and those logs before you build.
- **Commands:** `/start`, `/claim`, `/sync`, `/board`, `/decision`, `/log-failure`, `/handoff` (in `.claude/commands/`).
- **Skills:** `project-memory` (when and how to write things down), `token-factory` (any LLM call),
  `demo-prep` (demo, pitch, judging), the Tavily web-search skills, and the Nebius skills: `nebius-corrections`
  (start here for anything Nebius), `nebius-token-factory`, `nebius-token-factory-custom-models` and `nebius-sandboxes`.
  The `nebius-cloud` plugin adds `nebius-cloud:nebius-*` for AI Cloud. Don't vendor copies of those into
  `.claude/skills/`, because they'd load twice.
- `nebius config get private-key` is denied in `.claude/settings.json` (several plugin skills pre-approve `nebius config get:*`).
- Your personal auto-memory lives only on this laptop, so teammates can't see it. Anything the team needs goes in
  the repo files listed in AGENTS.md, not only in memory.
- When the user says they're done, taking a break, or the context is getting long, offer `/handoff`.
