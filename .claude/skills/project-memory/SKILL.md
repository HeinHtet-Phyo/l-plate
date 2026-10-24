---
name: project-memory
description: >-
  Keeps this team repo's shared memory (HANDOFF.md, docs/PROJECT.md, docs/DECISIONS.md,
  docs/MODEL_FAILURES.md, docs/sessions/) current, so any agent on any teammate's laptop can pick
  up exactly where the last one stopped. Use when starting work in this repo; when a decision is made
  (idea, stack, model, API or schema, scope cut); when a model misbehaves; when a task is finished,
  abandoned or blocked; when an interface teammates depend on changes; and before stopping, when the
  user says done, wrap up or break, or when context is long or about to be compacted.
---

# Project memory protocol

Five people and their agents build this in parallel today. Chat history and personal agent memory
(including Claude's auto-memory) never leave the laptop they're on, **so anything not written into the repo is lost to the team.**
The files are described in `AGENTS.md` §2. This skill covers *when* to write and *what good looks like*.

## Triggers and actions

| When this happens | Do this | Command |
|---|---|---|
| Session starts, or you resume after a break | Read `HANDOFF.md`, `docs/PROJECT.md`, the 3 newest session logs; `git pull --rebase` | `/start` |
| You're about to build something | Claim it in your lane and **push the claim** | `/claim` |
| A decision is made (idea, stack, model, API/schema, scope cut, "we won't do X") | Append to `docs/DECISIONS.md` and push | `/decision` |
| A model misbehaves (bad JSON, wrong/missing tool call, hallucination, refusal, slow, 429) | Append to `docs/MODEL_FAILURES.md`, even if you fixed it | `/log-failure` |
| An interface others use changes (route, schema, env var, model ID, folder layout, run command) | Update `docs/PROJECT.md`, note it in your lane, push soon | none |
| A task is finished, abandoned or blocked, or it's been ~45 min since your lane changed | Update your lane (Status, Next, Updated); commit | none |
| You're stopping, taking a break, or the context is long or about to be compacted | Full handoff | `/handoff` |

When the human says something like "ok that's done", "let's stop", or "I'm going to lunch", offer `/handoff`.
When you notice a decision or a model failure in passing, offer to log it in one line rather than interrupting the flow.

## What good entries look like

- **Concrete:** paths (`src/agent.py:42`), commands, exact error text, model IDs and numbers (`3/10 runs`, `8.2 s`).
- **Written for a stranger.** The next reader is a fresh agent with none of your chat history.
- **Actionable next steps:** "wire `/api/search` to `retriever.search()`, test with `data/sample.pdf`",
  not "continue backend".
- **The right size:** `HANDOFF.md` is a board, not a diary, so keep it under ~150 lines. Detail goes in the session log.
- **Safe:** no API keys, no `.env` contents, no giant log dumps.

## Ownership and conflicts

- **`HANDOFF.md`:** edit your own lane only. Change shared sections one line at a time, without reordering.
- **`DECISIONS.md`, `MODEL_FAILURES.md`:** append at the bottom and end with a blank line. Never edit others' entries.
  Git union-merges these files, so parallel appends don't conflict.
- **`docs/sessions/`:** add one new file per session. Never edit others' logs.
- **Docs drift.** If the code or `git log` contradicts `HANDOFF.md` or `PROJECT.md`, trust the code, fix the doc, and tell the human.

## Formats

The templates sit at the top of each file: `docs/DECISIONS.md`, `docs/MODEL_FAILURES.md`, `docs/sessions/README.md`.
Get timestamps from `date '+%Y-%m-%d %H:%M'` (local time). Your handle is your GitHub handle, as used in the `HANDOFF.md` lanes.
