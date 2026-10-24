# Decisions

> **Append-only.** Add new entries at the bottom and end each one with a blank line. Never edit or delete
> someone else's entry. To change a decision, add a new entry that says `Supersedes:`.
> Git keeps both sides when two people append at once (`merge=union` in `.gitattributes`).
>
> Format:
>
> ```
> ## YYYY-MM-DD HH:MM: <short title> (@handle)
> - **Decision:** what we chose
> - **Why:** the reason, including constraints
> - **Alternatives:** what we didn't pick and why
> - **Affects:** files, people, or tasks this changes
> ```

## 2026-10-24 11:44: The repo is the team's shared agent memory (@minthantkyaw28)
- **Decision:** `AGENTS.md` is the single entry point for every agent (CLAUDE.md and GEMINI.md import it).
  `HANDOFF.md` is the live board with one lane per teammate. `docs/` holds the brief, append-only logs and
  per-session logs. `.claude/` holds Claude Code commands, skills and a SessionStart hook that loads the board automatically.
- **Why:** five people and their agents work in parallel for one day. Chat history and per-user agent memory
  don't travel between laptops, so anything not in the repo is lost to the team.
- **Alternatives:** GitHub Issues or Projects (agents only see them through extra `gh` calls, and it's slower for a one-day build);
  one shared notes file (constant merge conflicts).
- **Affects:** everyone. Start every session by reading `AGENTS.md`.

## 2026-10-24 11:44: Vendor the Tavily skills into .claude/skills/ (@minthantkyaw28)
- **Decision:** copy all 8 skills from `tavily-ai/skills@778122e` (MIT, LICENSE kept per folder) into `.claude/skills/tavily-*`, instead of using the plugin or `npx skills add`.
- **Why:** teammates get them on clone with zero install steps. The plugin only bundles the same folders (no MCP, no hooks), and vendoring keeps the plain `/tavily-search` names.
- **Alternatives:** the Tavily plugin marketplace (renames the skills to `tavily:*`; an extra step per person); `npx skills add` / `tvly init` (installs per user into `~/.claude/skills`, which risks duplicates).
- **Affects:** everyone. Each person still installs the `tvly` CLI (`uv tool install tavily-cli`). Updating means re-copying from upstream.

## 2026-10-24 11:57: Nebius skills: plugin for AI Cloud, repo copies only for our own (@minthantkyaw28)
- **Decision:** the 14 AI Cloud skills (`nebius-api-debug` … `nebius-serverless-troubleshooting`) come only from the `nebius-cloud` plugin, so the pasted copies were deleted. The 4 skills not in the plugin (`nebius-corrections`, `nebius-token-factory`, `nebius-token-factory-custom-models`, `nebius-sandboxes`) live in `.claude/skills/`. They were rewritten from another project (L-Plate) for this repo. `.claude/settings.json` denies `nebius config get private-key`.
- **Why:** the copies were byte-identical to the plugin at `nebius/skills@8707c2d`, so every skill loaded twice. The 4 extras held another project's paths and rules (`apps/server/.env`, `VITE_`, learner data). 11 plugin skills pre-approve `nebius config get:*`, which also matches the private-key command.
- **Alternatives:** keep the vendored copies and drop the plugin (loses updates, and everyone's settings already enable the plugin); keep the L-Plate text as is (misleading paths and rules).
- **Affects:** anyone using Nebius beyond basic inference. Start at `nebius-corrections`. Don't vendor plugin skills into `.claude/skills/`.

