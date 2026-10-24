# AGENTS.md

Shared instructions for **every** coding agent on this repo: Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot,
Windsurf, Aider, and so on. Five people and their agents work here in parallel during a one-day hackathon. Your chat
history and your personal agent memory stay on one laptop, so **the repo is the team's memory**. If it isn't written in
the files below, the next agent won't know it.

Nothing here depends on one tool. The memory is plain markdown. The workflows and how-to guides are standard
[Agent Skills](https://agentskills.io) in `.agents/skills/`. The session-start context comes from a plain shell script.

## 1. Read before you do anything

0. **Is there a "Team context" block in your context already?** Claude Code and Cursor add one automatically at session start.
   If you don't have one, run `bash .agents/hooks/session-start.sh` and read the output: git sync status, recent commits,
   the latest `HANDOFF.md` from origin, and the newest session logs.
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
| `docs/MODEL_FAILURES.md` | Where models broke: bad JSON, wrong tool calls, overloads, latency | Everyone | **Append-only**. This is demo material |
| `docs/sessions/*.md` | One log per agent session: what was done, the state left in, next steps | Author only | New file per session, never edit others' |
| `.agents/skills/<name>/SKILL.md` | Workflows (§5) and how-to guides: Token Factory and other Nebius products, Tavily search, project memory, demo prep | Anyone | Standard Agent Skills. Plain markdown any agent can read |
| `.agents/hooks/session-start.sh` | Prints the team context at session start | Anyone | Wired into Claude Code and Cursor; other agents run it by hand |
| `skills-lock.json` | Source and hash of third-party skills (`nebius/skills`) | `npx skills` | Update with `npx skills update -p`, then re-check `nebius-corrections` |

## 3. Working rules

- **Claim before you build.** Put the task in your lane in `HANDOFF.md`, then commit and push that change right away
  (`chore(handoff): @you claims <task>`) so no two agents build the same thing.
- **Write it down when it happens, not at the end.** Log a decision in `docs/DECISIONS.md`. When a model
  misbehaves, log it in `docs/MODEL_FAILURES.md` even if you fixed it. If an interface others rely on
  changes (API route, schema, env var, model ID, folder layout), update `docs/PROJECT.md` and push soon.
- **Hand off before you stop.** Write a session log, update your lane, commit, pull with rebase, push.
  Do the same before a long break or when your context is getting long or about to be compacted. The test: a fresh
  agent, in a *different tool* on another teammate's laptop, can carry on from the files alone.
- **Be concrete.** Give file paths (`src/agent.py:42`), commands, exact error text, model IDs and numbers.
  "Next" means actions ("wire `/api/search` to `retriever.search()`"), not themes ("continue backend").
- **Trust the code over the docs.** If `git log` or the code contradicts `HANDOFF.md`, fix the doc and tell your human.
- **Ask before anything billable** beyond per-token inference: dedicated endpoints, fine-tunes, GPU VMs, Serverless
  jobs or endpoints. If you leave one running, put it and the command that stops it in your `HANDOFF.md` lane.
- **Secrets never enter git, chat or logs.** Keys go in `.env` (gitignored); `.env.example` lists the names.
  Before every commit, check that `git diff --cached` contains no keys. Never run `nebius config get private-key`.
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

Every workflow is a skill at `.agents/skills/<name>/SKILL.md`. **How to run one:**
- **Claude Code or Cursor:** type `/<name>`.
- **Codex:** mention `$<name>` or pick it from `/skills`.
- **Any other agent:** "follow `.agents/skills/<name>/SKILL.md`".

If your human says "start the session", "claim X" or "hand off", they mean these. Where a skill says `$ARGUMENTS`,
it means whatever the human typed after the command.

| Skill | When |
|---|---|
| `start [task]` | Beginning of every session |
| `claim <task>` | Before building something |
| `sync` | Pull teammates' work, resolve conflicts, see what changed |
| `board` | Read-only view of who's on what |
| `decision <what>` | A choice the team should remember |
| `log-failure <what>` | A model did something wrong |
| `handoff [notes]` | Before you stop, take a break, or hit a full context |

The `project-memory` skill says *when* to use them; `demo-prep` turns the logs into the judging demo.

## 6. Setup by tool

| Tool | Reads these instructions from | Finds skills in | Session-start context |
|---|---|---|---|
| Claude Code | `CLAUDE.md`, which imports this file | `.claude/skills/` (symlinks into `.agents/skills/`) | Automatic (`.claude/settings.json`) |
| Cursor | `AGENTS.md` | `.agents/skills/` | Automatic (`.cursor/hooks.json`) |
| Codex | `AGENTS.md` | `.agents/skills/` | Automatic once you trust the folder and approve the hook in `/hooks` (`.codex/hooks.json`). Until then, run the script (§1, step 0) |
| Gemini CLI | `GEMINI.md`, which imports this file | `.agents/skills/` | Run the script |
| GitHub Copilot | `AGENTS.md` | `.agents/skills/` | Run the script |
| Windsurf, Aider, others | `AGENTS.md` (Aider: `aider --read AGENTS.md`) | Open `.agents/skills/<name>/SKILL.md` directly | Run the script |

**Adding or changing a skill:**
- **Real files go only in `.agents/skills/<name>/`.** The `SKILL.md` frontmatter needs a `name` equal to the folder name, plus a `description`.
- **Then link it for Claude Code:** `ln -s ../../.agents/skills/<name> .claude/skills/<name>`.
- **Never put a real skill folder in `.claude/skills/`, `.cursor/skills/` or `.codex/skills/`.** Cursor reads several of those, so a second copy loads twice.
- **Third-party skills:** `npx skills add <owner/repo> -a claude-code -a cursor -a codex`. It writes `.agents/skills/`, the Claude symlinks and `skills-lock.json` in one go.

**Tool-specific extras** are optional and live in each tool's folder:
- `.claude/settings.json`: plugins, the hook, and a deny rule for `nebius config get private-key`.
- `.cursor/hooks.json`: the session-start hook.
- `.cursor/mcp.json`: Context7 docs and Playwright browser MCP servers.
- `.codex/hooks.json`: the session-start hook for Codex.

## 7. Project quick facts

- **Event:** Noetic x Nebius hackathon, a one-day build. Judging at 16:30. Judges want *a working example with a clear
  purpose*: show **what it does**, **where models struggle**, and **why it matters**.
- **LLMs:** Nebius Token Factory (OpenAI-compatible, `https://api.tokenfactory.nebius.com/v1`, key `NEBIUS_API_KEY`).
  Read `.agents/skills/token-factory/SKILL.md` before writing any LLM call; `nebius-token-factory` is the deeper API reference.
  For anything else Nebius (fine-tuning, dedicated endpoints, Sandboxes, AI Cloud), start at
  `.agents/skills/nebius-corrections/SKILL.md`. It routes to the right skill and lists known errors in the upstream ones.
- **Web search:** the Tavily skills (`.agents/skills/tavily-*`: search, extract, map, crawl, research) call the `tvly` CLI.
  Install it with `uv tool install tavily-cli`; the key is `TAVILY_API_KEY`. For Tavily inside app code, read `tavily-best-practices`.
- **Idea, stack, run and test commands:** see `docs/PROJECT.md`. Fill it in as soon as they're decided.
- **Team (GitHub handles):** @minthantkyaw28, @christopherwhite06, @HeinHtet-Phyo, @Aryaan2303, @jai-matharu.
