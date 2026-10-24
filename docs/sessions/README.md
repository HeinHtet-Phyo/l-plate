# Session logs

One file per agent session, written at handoff (`/handoff`). Each session gets its own file, so these never
merge-conflict. **Never edit someone else's log.** If it's wrong, say so in your own log and fix `HANDOFF.md`.

**Filename:** `YYYY-MM-DD-HHMM-<github-handle>-<short-slug>.md`, using local time at session start,
e.g. `2026-10-24-1415-jai-matharu-rag-retriever.md`. Names sort chronologically, so `ls docs/sessions | tail -3`
lists the newest three.

**The bar:** a fresh agent on another teammate's laptop, with none of your chat history, can carry on from
this file plus `HANDOFF.md`.

## Template

```markdown
# <short title>: @<handle>: YYYY-MM-DD HH:MM–HH:MM

- **Agent:** <tool + model, e.g. Claude Code / Opus 5.5, Codex, Cursor>
- **Branch:** <branch> @ <short sha at handoff>

## Goal
What this session set out to do (one or two lines).

## Done
- Concrete changes, with paths (`src/x.py`), commands, and commit shas.

## State left in
- What works now (and how to see it: the command or URL).
- What's half-done, broken or uncommitted, plus any failing tests and their exact error.

## Next steps
1. Concrete, ordered actions the next agent can start on immediately.

## Gotchas / learnings
- Surprises, dead ends, model quirks (also log those in `docs/MODEL_FAILURES.md`), env setup issues.

## Decisions / failures logged
- Links to entries added to `docs/DECISIONS.md` / `docs/MODEL_FAILURES.md` this session, or "none".
```
