# AGENTS.md

Shared instructions for **every** coding agent on this repo: Claude Code, Codex, Cursor, Gemini CLI,
Copilot, Windsurf, Aider, and so on. Five people and their agents work here in parallel during a
one-day hackathon. Your chat history and your personal agent memory stay on one laptop, so
**the repo is the team's memory**. If it isn't written in the files below, the next agent won't know it.

## 1. Read before you do anything

1. **`HANDOFF.md`**: where we left off. What works, who's on what, what's next, blockers.
2. **`docs/PROJECT.md`**: what we're building and why, the stack, how to run it, the demo plan.
3. **The 3 newest files in `docs/sessions/`** (filenames sort by time): detailed notes from recent sessions.
4. **`docs/DECISIONS.md`**: skim it. Don't relitigate a logged decision without asking your human.
5. Run `git status -sb` and `git pull --rebase`. Teammates push all day, so a stale checkout means duplicated work.

Then tell your human, in a few lines, where things stand and what you plan to work on.

## 2. Context files

| File | What it holds | Who edits | How |
|---|---|---|---|
| `AGENTS.md` | These rules (the entry point) | Anyone, rarely | Small edits; log the why in DECISIONS.md |
| `HANDOFF.md` | Live status board: snapshot, unclaimed tasks, one lane per teammate, blockers | Everyone | **Your own lane only**; shared sections line by line |
| `docs/PROJECT.md` | Brief: idea, scope, stack, layout, run/test commands, demo plan | Anyone | Keep it true; update when the facts change |
| `docs/DECISIONS.md` | Why we chose X over Y | Everyone | **Append-only**, newest at the bottom |
| `docs/MODEL_FAILURES.md` | Where models broke: bad JSON, wrong tool calls, hallucinations, latency | Everyone | **Append-only**. This is demo material |
| `docs/sessions/*.md` | One log per agent session: what was done, the state left in, next steps | Author only | New file per session, never edit others' |
| `.claude/skills/*/SKILL.md` | How-to guides (Token Factory and other Nebius products, Tavily search, project memory, demo prep) | Anyone | Plain markdown. Any agent can read them |
| `.claude/commands/*.md` | Step-by-step workflows (start, claim, sync, handoff…) | Anyone | Plain markdown. Any agent can follow them |

## 3. Working rules

- **Claim before you build.** Put the task in your lane in `HANDOFF.md`, then commit and push that change
  right away (`chore(handoff): @you claims <task>`) so no two agents build the same thing.
- **Write it down when it happens, not at the end.** Log a decision in `docs/DECISIONS.md`. When a model
  misbehaves, log it in `docs/MODEL_FAILURES.md` even if you fixed it. If an interface others rely on
  changes (API route, schema, env var, model ID, folder layout), update `docs/PROJECT.md` and push soon.
- **Hand off before you stop.** Write a session log, update your lane, commit, pull with rebase, push.
  Do the same before a long break or when your context is getting long or about to be compacted. The test: a fresh
  agent on another teammate's laptop can carry on from the files alone.
- **Be concrete.** Give file paths (`src/agent.py:42`), commands, exact error text, model IDs and numbers.
  "Next" means actions ("wire `/api/search` to `retriever.search()`"), not themes ("continue backend").
- **Trust the code over the docs.** If `git log` or the code contradicts `HANDOFF.md`, fix the doc and tell your human.
- **Ask before anything billable** beyond per-token inference: dedicated endpoints, fine-tunes, GPU VMs, Serverless
  jobs or endpoints. If you leave one running, put it and the command that stops it in your `HANDOFF.md` lane.
- **Secrets never enter git, chat or logs.** Keys go in `.env` (gitignored); `.env.example` lists the names.
  Before every commit, check that `git diff --cached` contains no keys.
- **Ship the demo path first.** Get one end-to-end path working before adding features. Judging starts **16:30**.

## 4. Git with five people

- `main` is the integration branch and must stay runnable. Make small commits often, run `git pull --rebase` before every push,
  and **never force-push `main`**.
- For risky or long work, use a branch named `<github-handle>/<topic>`, then merge or open a PR as soon as it works.
- Commit messages: `feat: …`, `fix: …`, `docs: …`, `chore(handoff): …`.
- Conflicts:
  - **`HANDOFF.md`**: keep every lane. Each person's own lane wins.
  - **Append-only logs**: git keeps both sides automatically (`merge=union` in `.gitattributes`).
  - **Code**: resolve it if both intents are clear. Otherwise abort and ask your human who to talk to.

## 5. Workflows

| Claude Code | When | File (any agent can follow it) |
|---|---|---|
| `/start [task]` | Beginning of every session | `.claude/commands/start.md` |
| `/claim <task>` | Before building something | `.claude/commands/claim.md` |
| `/sync` | Pull teammates' work, resolve conflicts, see what changed | `.claude/commands/sync.md` |
| `/board` | Read-only view of who's on what | `.claude/commands/board.md` |
| `/decision <what>` | A choice the team should remember | `.claude/commands/decision.md` |
| `/log-failure <what>` | A model did something wrong | `.claude/commands/log-failure.md` |
| `/handoff [notes]` | Before you stop, take a break, or hit a full context | `.claude/commands/handoff.md` |

**Not on Claude Code?** Open the command file and follow its steps. If your human says "start the session",
"claim X" or "hand off", they mean those files.

## 6. Project quick facts

- **Event:** Noetic x Nebius hackathon, a one-day build. Judging at 16:30. Judges want *a working example with a clear
  purpose*: show **what it does**, **where models struggle**, and **why it matters**.
- **LLMs:** Nebius Token Factory (OpenAI-compatible, `https://api.tokenfactory.nebius.com/v1`, key `NEBIUS_API_KEY`).
  Read `.claude/skills/token-factory/SKILL.md` before writing any LLM call. `nebius-token-factory` is the deeper API reference.
  For anything else Nebius (fine-tuning, dedicated endpoints, Sandboxes, AI Cloud), start at
  `.claude/skills/nebius-corrections/SKILL.md`. It routes to the right skill and lists known errors in the `nebius-cloud`
  plugin's skills.
- **Web search:** the Tavily skills (`.claude/skills/tavily-*`: search, extract, map, crawl, research) call the `tvly` CLI.
  Install it with `uv tool install tavily-cli`; the key is `TAVILY_API_KEY`. For Tavily inside app code, read `tavily-best-practices`.
- **Idea, stack, run and test commands:** see `docs/PROJECT.md`. Fill it in as soon as they're decided.
- **Team (GitHub handles):** @minthantkyaw28, @christopherwhite06, @HeinHtet-Phyo, @Aryaan2303, @jai-matharu.
