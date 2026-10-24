@AGENTS.md

## Claude Code specifics

Everything above is tool-neutral. This file only adds what's different in Claude Code.

- **Session start:** `.claude/settings.json` runs `.agents/hooks/session-start.sh` on startup, resume, `/clear` and after
  compaction, so the "Team context" block is already in your context (AGENTS.md §1 step 0 is done). It's a summary only:
  still read `docs/PROJECT.md` and the session logs it lists before you build.
- **Skills:** `.claude/skills/<name>` entries are symlinks into `.agents/skills/<name>`. Edit the real files in `.agents/skills/`.
  For a new skill, add the symlink (AGENTS.md §6). Every skill, including the workflows, runs as `/<name>`.
- **Plugins:** `.claude/settings.json` enables `frontend-design`, `feature-dev`, `context7`, `playwright` and `commit-commands`.
  `nebius-cloud` is deliberately **disabled**: its 14 AI Cloud skills are in `.agents/skills/` so every tool gets them,
  and enabling the plugin would load them twice.
- `nebius config get private-key` is denied in `.claude/settings.json`, because several upstream Nebius skills pre-approve `nebius config get:*`.
- Your personal auto-memory lives only on this laptop, so teammates can't see it. Anything the team needs goes in
  the repo files listed in AGENTS.md, not only in memory.
- When the user says they're done, taking a break, or the context is getting long, offer `/handoff`.
