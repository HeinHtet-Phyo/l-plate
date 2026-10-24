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


## 2026-10-24 12:50: Project is L-Plate, a driving-practice game with a phone as the controller (@HeinHtet-Phyo)
- **Decision:** build L-Plate: a 3D drive on real UK streets (from OSM) in the laptop browser. The player steers by tilting their phone, which pairs with the laptop through a QR code and a WebSocket session. An open model on Token Factory acts as the driving instructor and writes a UK-style mock-test report. Stack: React + Vite + react-three-fiber, Node `ws` relay, all in `app/`.
- **Why:** the purpose is clear and easy to demo, and judges can play it themselves. Fault reports and live coaching give a natural "where models struggle" story (made-up rules, wrong road names, wrong fault severity).
- **Alternatives:** keyboard controls (less memorable); a native app (no time).
- **Affects:** everyone. See `docs/PROJECT.md` for the build order.
## 2026-10-24 12:57: Agent-agnostic layout: everything canonical in .agents/, thin per-tool adapters (@minthantkyaw28)
- **Decision:**
  - All 36 skills, including the 7 workflows (`start` … `handoff`, formerly `.claude/commands/`), live in `.agents/skills/`. That's the standard project folder read by Cursor, Codex, Gemini CLI and Copilot.
  - Claude Code gets relative symlinks in `.claude/skills/`.
  - The session-start script moved to `.agents/hooks/`, wired for Claude (`.claude/settings.json`), Cursor (`.cursor/hooks.json`, JSON output) and Codex (`.codex/hooks.json`). Other agents run it by hand (AGENTS.md §1).
  - The 14 `nebius/skills` AI Cloud skills are installed into `.agents/skills/` with `npx skills` and pinned in `skills-lock.json`. The Claude `nebius-cloud` plugin is disabled.
  - The two broken upstream create scripts are patched so they really dry-run.
- **Supersedes:** "Nebius skills: plugin for AI Cloud, repo copies only for our own" (the plugin only works in Claude Code).
- **Why:** the team will use different tools (Cursor next). Verified live on 2026-10-24:
  - Cursor (`cursor-agent`), Codex (`codex exec`) and Claude Code (`claude -p`) each list all 36 skills exactly once.
  - Cursor and Claude Code get the Team context block, and Cursor loads AGENTS.md automatically.
  - Codex reads AGENTS.md. Its hook needs folder trust and `/hooks` approval, so it wasn't auto-tested.
- **Alternatives:** keep `.claude/` canonical and rely on Cursor's `.claude/skills` compatibility (Codex, Gemini and Copilot don't read it, and workflows would stay Claude-only); copy files per tool (they drift).
- **Affects:** everyone. Edit skills only in `.agents/skills/`, and add the Claude symlink for new ones (AGENTS.md §6).

## 2026-10-24 14:10: City renderer lighting contract and shared-uniform conventions (@minthantkyaw28)
- **Decision:**
  - `render/atmosphere/uniforms.ts` is committed on `feat/city` byte-for-byte as the stub in `TEAM-PLAN.md`, so Aryaan's copy merges cleanly.
  - Lamp map convention: `uv = xz · uLampScale.x + uLampScale.y`, with `x = 1/(n·cell)` and `y = radius/(n·cell)`. Data row = z, column = x (single channel, `unpackAlignment = 1`).
  - The city sets the shared uniforms each frame from `s.conditions` (`uDay`, `uOvercast`, `uRain`, sky colour), the clock and the learner's car (headlights). If `uLampMap` is still null, it uploads `s.lightMap` itself. The app calls `city.update` before `atmosphere.update`, so the real atmosphere overrides all of these once it lands.
  - City surfaces light themselves with the spec's formula (`0.1 + 0.9·day·(1 − 0.35·overcast)` + lamps + headlights) in `render/city/common.ts`. Buildings and props use Lambert materials lit by the atmosphere's hemisphere and sun lights, with streetlights and headlights added as emissive.
  - Traffic-light aspects are drawn from `s.world.time`, the clock the red-light fault uses.
- **Why:** each render section can be built and merged on its own, and the city looks right at night and in rain even with the fallback atmosphere.
- **Alternatives:** wait for Aryaan's atmosphere (blocks the city); put real THREE lights at 3,000 lamps (far too slow).
- **Affects:** @Aryaan2303 (atmosphere: please use the same lamp map uv convention), @christopherwhite06 (integration). Note that Chris's build decisions are in the root `DECISIONS.md`.


## 2026-10-24 15:20: Elephant & Castle Gaussian-splat street (@HeinHtet-Phyo)
- **Decision:**
  - The free drive `elephant-splat` gets a Gaussian-splat capture of about 320 m of real street, following `splat.md`.
  - Imagery: Panoramax sequence `8a558208-5401-4097-aab5-a609509595d1` by **RedAuburn**, **CC BY-SA 4.0**. The splat is a derived work, so it's CC BY-SA 4.0 too, and the credit shows in the HUD (`session.mapCredit` from `transform.json`).
  - Camera poses come from pycolmap 4.2.1 SfM (single OPENCV camera, sequential matching).
  - Training: Brush v0.3.0 on Hein's Apple M5 (Metal) rather than a CUDA box, since there's no NVIDIA PC available. Step count and splat count: pending.
  - Rendering: Spark (`@sparkjsdev/spark`) on three 0.180. The splat mesh uses `matrixAutoUpdate = false` with the column-major matrix from `apps/web/public/splats/elephant-splat/transform.json`.
  - Placement in the OSM local frame (x east, y up, z south) comes from levelling with the cameras' up vectors, then a 2D Umeyama fit of camera centres to the photos' GPS, with the ground at y = 0. GPS RMS: pending.
  - On that start only, the city buildings, trees, parked cars and road surface are hidden, and parked cars are skipped in physics. Traffic, signals and the cabin stay.
- **Why:** a real photographed street looks far better than procedural buildings, and it shows what open data plus open tools can do in a day.
- **Alternatives:** Google Photorealistic 3D Tiles (already used on Goodmayes, but coarse at street level); gsplat/Nerfstudio (needs CUDA); Postshot (Windows/NVIDIA).
- **Affects:** @christopherwhite06 (`apps/web/src/app/splat.ts`, `Drive.tsx`, `sim/session.ts` changes; pull `hein` onto the demo laptop).
