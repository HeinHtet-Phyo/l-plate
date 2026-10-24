# Agent memory system: @minthantkyaw28: 2026-10-24 11:33–11:57

- **Agent:** Claude Code / Opus 5.5
- **Branch:** main

## Goal
Set up a shared, cross-agent context system so any coding agent that picks up this repo knows the project,
the team's state, and where work was left off. Also add the Tavily web-search skills.

## Done
- `AGENTS.md`: the single entry point for all agents (reading order, file map, working rules, git rules, workflows).
  `CLAUDE.md` and `GEMINI.md` import it.
- `HANDOFF.md`: live board with Snapshot, Up next, one lane per teammate (all 5 GitHub collaborators), and Blockers.
- `docs/PROJECT.md` (brief template, mostly TBD), `docs/DECISIONS.md` (with the first entry),
  `docs/MODEL_FAILURES.md`, and `docs/sessions/README.md` (naming + template).
- `.claude/commands/`: `start`, `claim`, `sync`, `board`, `decision`, `log-failure`, `handoff`.
- `.claude/skills/`: `project-memory` (when and how to write things down) and `demo-prep` (DEMO.md + checklist).
- Tavily: all 8 skills vendored from `tavily-ai/skills@778122e` into `.claude/skills/tavily-*`, with MIT LICENSE files kept
  and a local "In this repo" setup note in `tavily-cli/SKILL.md`. `TAVILY_API_KEY` added to `.env.example`.
- `.claude/hooks/session-start.sh` is wired into `.claude/settings.json` (SessionStart: startup|resume|clear|compact).
  It fetches with a ~4 s cap, prints behind/ahead, uncommitted changes, recent commits, `HANDOFF.md` *from origin*,
  and the 3 newest session logs.
- `.gitattributes`: `merge=union` for `DECISIONS.md` and `MODEL_FAILURES.md`.
- `README.md`: teammate setup and an overview of the system.
- Nebius skills (pasted in mid-session from another project, L-Plate):
  - **Deleted 14 duplicates.** `nebius-api-debug` … `nebius-serverless-troubleshooting` were byte-identical to the `nebius-cloud`
    plugin at `nebius/skills@8707c2d`, so they loaded twice.
  - **Kept and rewrote 4 for this repo:** `nebius-corrections`, `nebius-token-factory`, `nebius-token-factory-custom-models`
    and `nebius-sandboxes`. Removed the `apps/server/.env`, `VITE_`, learner-data, `skills-lock.json`, T-037/D-005 and Gemini
    references, and added "Using it in Nebius-Hack" and "Rules for Nebius in this repo" sections.
  - **Cross-linked** `token-factory` and `nebius-token-factory`. Added the `json_schema` alternative to `guided_json`.
  - **`.claude/settings.json`:** denies `nebius config get private-key`. AGENTS.md now has an "ask before anything billable" rule.
    `.DS_Store` is gitignored.

## State left in
- No app code yet. The project idea isn't chosen, so `docs/PROJECT.md` is mostly TBD.
- Verified: a scratch repo showed that `merge=union` survives a concurrent append + `git pull --rebase` with no conflict
  (entries need a trailing blank line to stay separated, which the formats now say). The hook runs in about 0.6 s.
  In a stale clone it shows the "N behind" warning and the teammate's `HANDOFF.md` from origin before pulling.

## Next steps
1. Whole team: pick the idea and fill in `docs/PROJECT.md` (log it with `/decision`).
2. Each teammate: `cp .env.example .env`, add keys, open in Claude Code, accept plugins and the hook, run `/start`.
3. Choose the stack and scaffold the app, then update the "Run locally" / "Test" lines in `docs/PROJECT.md` and the quick facts in `AGENTS.md`.

## Gotchas / learnings
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`, hence the `@AGENTS.md` import. Gemini CLI reads `GEMINI.md`.
- Project hooks only run after the teammate trusts the folder in Claude Code.
- Personal Claude auto-memory is per-laptop, so it can't be the team's memory.
- Tavily skills call the `tvly` CLI, which doesn't read `.env`. Authenticate once with `tvly login --api-key "$TAVILY_API_KEY"`.
  Don't run `tvly init` / `npx skills add`, because they install a duplicate set into `~/.claude/skills`. Search and extract work keyless
  up to a free rate limit; map, crawl and research need the key. No live Tavily call was tested (no key or CLI on this laptop).
- `tavily-dynamic-search` pre-approves `python3 *` / `uv run *` / `jq *` while the skill is active (upstream setting, left as is).
- I verified two hazards in the `nebius-cloud` plugin myself. (1) Its `nebius-serverless-jobs/assets/job-create.sh` and
  `nebius-serverless-endpoints/assets/endpoint-create.sh` are broken: on line 7, `\` followed by `# comment` ends the command,
  so it runs a **real create without `--dry-run`**. Never run or paste them. (2) 11 plugin skills pre-approve
  `nebius config get:*`. `nebius-corrections` records both.

## Decisions / failures logged
- `docs/DECISIONS.md`: "The repo is the team's shared agent memory", "Vendor the Tavily skills into .claude/skills/",
  and "Nebius skills: plugin for AI Cloud, repo copies only for our own".
