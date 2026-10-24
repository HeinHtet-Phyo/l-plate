# HANDOFF

> Live status board. Every agent reads it at the start of a session and updates it before stopping.
> **Edit only your own lane.** In the shared sections, change single lines; don't reorder or rewrite.
> Keep this file under ~150 lines. Details belong in `docs/sessions/`.

Last updated: 2026-10-24 11:57 by @minthantkyaw28

## Snapshot

- **Idea:** not chosen yet. Decide it, then fill in `docs/PROJECT.md`.
- **Works end-to-end:** nothing yet (no app code).
- **Repo has:** the shared agent memory system (AGENTS.md, this board, `docs/`, `.claude/` commands, skills and hook),
  the Token Factory skill, the Nebius skills (start at `nebius-corrections`), the Tavily skills, and project plugins.
- **Judging:** 16:30 today.

## Up next (unclaimed)

<!-- To claim a task, move it into your lane and push right away (/claim). Add new tasks at the bottom. -->
- [ ] Pick the project idea and fill in `docs/PROJECT.md` (idea, user, why it matters, demo path). Whole team, do it first.
- [ ] Choose the stack and scaffold the app skeleton, with model IDs in one config constant.
- [ ] Everyone: put `NEBIUS_API_KEY` (and `TAVILY_API_KEY`) in `.env`, run the `/v1/models` check from the token-factory skill, and `uv tool install tavily-cli` (see README).
- [ ] Build a small model-comparison harness for the "where models struggle" part of the demo (see token-factory skill).

## Lanes

### @minthantkyaw28
- **Status:** done. Set up the agent memory system, the Tavily skills, and cleaned up and adapted the Nebius skills.
- **Working on:** nothing
- **Next:** pick a task from Up next
- **Branch:** main
- **Updated:** 2026-10-24 11:57
- **Log:** `docs/sessions/2026-10-24-1133-minthantkyaw28-agent-memory-system.md`

### @christopherwhite06
- **Status:** done. Set up the Claude Code plugins and the token-factory skill.
- **Working on:** nothing
- **Next:** nothing yet
- **Branch:** main
- **Updated:** 2026-10-24 10:25
- **Log:** none

### @HeinHtet-Phyo
- **Status:** not started
- **Working on:** nothing
- **Next:** nothing yet
- **Branch:** none
- **Updated:** never
- **Log:** none

### @Aryaan2303
- **Status:** not started
- **Working on:** nothing
- **Next:** nothing yet
- **Branch:** none
- **Updated:** never
- **Log:** none

### @jai-matharu
- **Status:** not started
- **Working on:** nothing
- **Next:** nothing yet
- **Branch:** none
- **Updated:** never
- **Log:** none

## Blockers / questions for the humans

<!-- Format: - [@who] question or blocker (since HH:MM) -->
- None yet.
