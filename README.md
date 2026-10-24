# Nebius-Hack

Our Noetic x Nebius hackathon project. **The idea isn't chosen yet.** Once it is, the brief lives in [`docs/PROJECT.md`](docs/PROJECT.md).
Live status (who's on what, what's next) is in [`HANDOFF.md`](HANDOFF.md).

## Teammate setup (about 5 minutes)

1. `git clone https://github.com/christopherwhite06/Nebius-Hack && cd Nebius-Hack`
2. `cp .env.example .env` and fill in the keys. Never commit `.env`.
   - `NEBIUS_API_KEY`: tokenfactory.nebius.com → profile → API Keys
   - `TAVILY_API_KEY`: app.tavily.com (only needed for web search)
   - Web search skills need the Tavily CLI: `uv tool install tavily-cli`, then
     `set -a; . ./.env; set +a; tvly login --api-key "$TAVILY_API_KEY"`. Don't run `tvly init` or `npx skills add`,
     because the skills are already in the repo.
3. Open the repo in Claude Code (`claude`). When prompted, trust the folder, install the project plugins, and allow the hook.
4. Type **`/start`**. Your agent reads where the team left off, syncs with git, and helps you claim a task.
5. When you stop, type **`/handoff`**.

**Using a different agent?** Codex, Cursor, Copilot and Windsurf read `AGENTS.md` automatically, and Gemini CLI reads
`GEMINI.md`. With Aider, run `aider --read AGENTS.md`. Then tell it: *"start the session as described in AGENTS.md"*.
The command files in `.claude/commands/` are plain markdown that any agent can follow.

## How the shared agent memory works

Chat history and personal agent memory never leave the laptop they're on, so the **repo** is the team's memory:

```
AGENTS.md              rules + reading order. Every agent's entry point (CLAUDE.md and GEMINI.md import it)
HANDOFF.md             live board: snapshot, unclaimed tasks, one lane per teammate, blockers
docs/PROJECT.md        the brief: idea, scope, stack, run/test commands, demo plan
docs/DECISIONS.md      append-only "why we chose X"
docs/MODEL_FAILURES.md append-only "where the model broke" (demo material for judging)
docs/sessions/         one log per agent session: done / state left in / next steps
.claude/commands/      /start /claim /sync /board /decision /log-failure /handoff
.claude/skills/        token-factory, tavily, project-memory, demo-prep
.claude/hooks/         session-start.sh: loads the board and git status into every Claude session
```

**The loop:** `/start` → `/claim <task>` → build (run `/decision` and `/log-failure` as things happen) → `/handoff`.
Run `/sync` to pull teammates' work and `/board` to see the whole team at a glance.

Conflicts stay rare by design. Each person edits only their own lane in `HANDOFF.md`, session logs are separate files,
and the two append-only logs are union-merged by git (`.gitattributes`).
