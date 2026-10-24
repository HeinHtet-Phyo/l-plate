# Nebius-Hack

Our Noetic x Nebius hackathon project. **The idea isn't chosen yet.** Once it is, the brief lives in [`docs/PROJECT.md`](docs/PROJECT.md).
Live status (who's on what, what's next) is in [`HANDOFF.md`](HANDOFF.md).

## Teammate setup (about 5 minutes, any coding agent)

1. `git clone https://github.com/christopherwhite06/Nebius-Hack && cd Nebius-Hack`
2. `cp .env.example .env` and fill in the keys. Never commit `.env`.
   - `NEBIUS_API_KEY`: tokenfactory.nebius.com → profile → API Keys
   - `TAVILY_API_KEY`: app.tavily.com (only needed for web search)
   - Web search skills need the Tavily CLI: `uv tool install tavily-cli`, then
     `set -a; . ./.env; set +a; tvly login --api-key "$TAVILY_API_KEY"`. Don't run `tvly init` or `npx skills add tavily-ai/skills`,
     because the skills are already in the repo.
3. Open the repo in your agent:
   - **Claude Code** (`claude`): trust the folder, install the project plugins, and allow the hook when prompted.
   - **Cursor:** open the folder. It reads `AGENTS.md`, the skills in `.agents/skills/`, the hook in `.cursor/hooks.json`
     and the MCP servers in `.cursor/mcp.json`. Approve the MCP servers if asked.
   - **Codex:** reads `AGENTS.md` and `.agents/skills/`. Trust the folder, then approve the session-start hook in `/hooks`.
   - **Gemini CLI / Copilot:** they read `AGENTS.md` (Gemini through `GEMINI.md`) and `.agents/skills/`.
   - **Anything else:** point it at `AGENTS.md` (Aider: `aider --read AGENTS.md`).
4. Type **`/start`** (Codex: `$start`; other agents: *"start the session as described in AGENTS.md"*). Your agent reads where
   the team left off, syncs with git, and helps you claim a task.
5. When you stop, type **`/handoff`**.

You can switch tools mid-project, say from Claude Code to Cursor. The memory is in the repo, not in the tool.

## How the shared agent memory works

Chat history and personal agent memory never leave the laptop they're on, so the **repo** is the team's memory:

```
AGENTS.md              rules + reading order. Every agent's entry point (CLAUDE.md and GEMINI.md import it)
HANDOFF.md             live board: snapshot, unclaimed tasks, one lane per teammate, blockers
docs/PROJECT.md        the brief: idea, scope, stack, run/test commands, demo plan
docs/DECISIONS.md      append-only "why we chose X"
docs/MODEL_FAILURES.md append-only "where the model broke" (demo material for judging)
docs/sessions/         one log per agent session: done / state left in / next steps
.agents/skills/        every skill, as standard SKILL.md folders:
                         workflows: start claim sync board decision log-failure handoff
                         guides:    token-factory, nebius-* (Token Factory, fine-tuning, Sandboxes, AI Cloud), tavily-*,
                                    project-memory, demo-prep
.agents/hooks/         session-start.sh: prints the board and git status for any agent
skills-lock.json       pinned source of the third-party nebius/skills
.claude/               Claude Code adapter: settings (plugins, hook, deny rule) + skills/ symlinks into .agents/skills
.cursor/               Cursor adapter: hooks.json (session start) + mcp.json (Context7, Playwright)
.codex/                Codex adapter: hooks.json (session start)
```

**The loop:** `/start` → `/claim <task>` → build (run `/decision` and `/log-failure` as things happen) → `/handoff`.
Run `/sync` to pull teammates' work and `/board` to see the whole team at a glance.

Conflicts stay rare by design. Each person edits only their own lane in `HANDOFF.md`, session logs are separate files,
and the two append-only logs are union-merged by git (`.gitattributes`).
