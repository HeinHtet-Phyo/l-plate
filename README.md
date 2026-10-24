# L-Plate

Practise driving on real UK streets, with an AI driving instructor in the passenger seat.
Built in one day for the Noetic x Nebius hackathon (2026-10-24).

Open the game on a laptop, scan the QR code with a phone, and the phone becomes the steering wheel (tilt to steer,
on-screen pedals). You drive a real DVSA-style test route rebuilt in 3D from OpenStreetMap: real roads, junctions, traffic lights,
zebra crossings, parked cars and buildings. Sam, the instructor (Nebius Token Factory, `Qwen/Qwen3-30B-A3B-Instruct-2507`),
reads out sat-nav directions and comments on your driving. At the end, an examiner model (`Qwen/Qwen3-235B-A22B-Instruct-2507`,
strict JSON schema) writes a mock-test debrief: driving, serious and dangerous faults, PASS/FAIL, and advice tied to Highway Code rules
retrieved from `Qwen/Qwen3-Embedding-8B` embeddings.

- **Brief and demo plan:** [`docs/PROJECT.md`](docs/PROJECT.md). **Who does what:** [`TEAM-PLAN.md`](TEAM-PLAN.md). **Live status:** [`HANDOFF.md`](HANDOFF.md).
- **Where the models struggle:** [`docs/MODEL-NOTES.md`](docs/MODEL-NOTES.md) and [`docs/MODEL_FAILURES.md`](docs/MODEL_FAILURES.md).

## Quick start

Needs Node 22.18 or newer (for TypeScript type stripping) and pnpm (via corepack).

```bash
git clone https://github.com/christopherwhite06/Nebius-Hack && cd Nebius-Hack
corepack enable && pnpm install
cp apps/server/.env.example apps/server/.env   # add NEBIUS_API_KEY; never commit it
pnpm --filter @lplate/server dev                # API + phone relay on :8080 (PORT=8090 to change)
pnpm --filter @lplate/web dev                   # game on http://localhost:5173 (SERVER_PORT=8090 if you moved the server)
```

Open <http://localhost:5173/?route=goodmayes> to jump straight into the Goodmayes test route.
Without a Nebius key the game still runs: Sam is silent and the debrief is rule-based (`source: "offline"`).

For a phone on another network, run `pnpm tunnel` (ngrok on :5173) or set `PUBLIC_URL`. On the same Wi-Fi the QR code uses the laptop's LAN address.

### Environment

| Variable | Where | What |
|---|---|---|
| `NEBIUS_API_KEY` | `apps/server/.env` | Token Factory key (tokenfactory.nebius.com → API Keys). Enables Sam, the examiner and rule search |
| `NEBIUS_MODEL_INSTRUCTOR` / `_EXAMINER` / `_EMBED` | `apps/server/.env` | Model overrides; defaults are the three Qwen models above |
| `NEBIUS_MODEL_RERANK` | `apps/server/.env` | Optional rerank model for Highway Code search (cosine order otherwise) |
| `PUBLIC_URL` | `apps/server/.env` | Public https URL for the phone QR code (otherwise ngrok's local API is asked) |
| `OSRM_URL` | `apps/server/.env` | Routing server for off-route rerouting (default: the public OSRM demo) |
| `PORT`, `LOG_LEVEL` | shell | Server port (8080) and log level |
| `VITE_GOOGLE_MAPS_BROWSER_KEY`, `VITE_GOOGLE_MAPS_MAP_ID` | `apps/web/.env` | Optional Google map overlay on the sat nav |
| `TAVILY_API_KEY` | root `.env` | Only for the agents' web-search skills |

### URL shortcuts

`?route=<id>` (goodmayes, mill-hill, isleworth, morden, belvedere) · `?start=<free-drive id>` · `&weather=sunny|cloudy|rain|fog|night|night-rain`
· `&voice=0` · `&mirrors=0` · `&map=0`

## Scripts

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest: `apps/web/test` (sim core) and `apps/server/test` (relay, instructor, Nebius client, routes) |
| `pnpm build` | Production build of the web app; typecheck of the server (it runs from TS source) |
| `pnpm osm:fetch <area> [--force]` | Download an area from Overpass into `apps/web/public/osm/<area>.json` (local metres) |
| `node scripts/osm-stats.ts` | Element counts per extract, with warnings for empty or suspicious areas |
| `pnpm build:routes` | Rebuild `apps/web/src/routes/test-routes.json` from the route waypoints via OSRM |
| `pnpm build:rules` | Highway Code → embeddings at `apps/server/data/highway-code.json` (needs `NEBIUS_API_KEY`) |
| `pnpm scan-secrets [--staged]` | Scan the git index and history for leaked keys; exits 1 if any are found |
| `pnpm tunnel` | ngrok tunnel to the web app for phones off the LAN |

## Layout

```
apps/web/            React + Vite + three.js (react-three-fiber) game
  src/sim/           pure simulation, no three.js: geo, OSM roads, rasters, signals, city layout, vehicle, world,
                     traffic (IDM), sat nav, conditions (sun, weather), faults, coach, session
  src/render/        three.js parts: city, atmosphere, traffic, cabin (see render/types.ts for the contract)
  src/app/           menu, drive screen, HUD, summary
  src/phone/         phone controller page (/c/:session) and tilt maths
  src/net/           pairing and speech
  public/osm/        committed OSM extracts (9 areas)
  src/routes/        5 test routes and free-drive starts
  test/              Vitest suites
apps/server/         Fastify: /api/pair + /ws relay, /api/instructor, /api/debrief, /api/route, /api/rules/search
  data/              Highway Code embeddings
  test/              Vitest suites
packages/shared/     types shared by web and server (protocol, routes, debrief)
scripts/             data builders, OSM stats, secret scan
```

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, ODbL. Fetched through the Overpass API.
- Routing by [OSRM](https://project-osrm.org/) (public demo server).
- Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0). Sun position from the NOAA low-precision formulas.
- [The Highway Code](https://www.gov.uk/guidance/the-highway-code), © Crown copyright, used under the Open Government Licence v3.0.
- Models served by [Nebius Token Factory](https://tokenfactory.nebius.com/): Qwen3 30B-A3B Instruct, Qwen3 235B-A22B Instruct, Qwen3 Embedding 8B.
- Test routes are typical of the roads around each test centre, not official DVSA routes.
- Team: @christopherwhite06, @minthantkyaw28, @HeinHtet-Phyo, @Aryaan2303, @jai-matharu.

## Agent setup (about 5 minutes, any coding agent)

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
