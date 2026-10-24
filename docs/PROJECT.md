# Project brief

> This file is the source of truth for **what** we're building. Update it whenever the idea, scope, stack,
> layout or run commands change, and log the *why* in `DECISIONS.md`. Replace each "TBD" as soon as it's known.

## Hackathon

- **Event:** Noetic x Nebius hackathon, a one-day build (2026-10-24). **Judging starts 16:30.**
- **What judges want:** a working example with a clear purpose. The demo must show
  1. **what it does**,
  2. **where the models struggle** (evidence comes from `docs/MODEL_FAILURES.md`),
  3. **why it matters**.
- **Constraint:** models run on Nebius Token Factory (see `.agents/skills/token-factory/SKILL.md`).

## Team

| GitHub | Focus |
|---|---|
| @minthantkyaw28 | City renderer: road surface, markings, buildings, trees, parked cars, streetlights, signals (`apps/web/src/render/city/**`) |
| @christopherwhite06 | App shell, render loop, HUD, menu, integration; merges PRs |
| @HeinHtet-Phyo | Phone controller page, then cabin, mirrors, sat nav screen, windscreen rain |
| @Aryaan2303 | Sky, lights, weather, night, AI-traffic meshes |
| @jai-matharu | Tests, typecheck/build, server extras, data, README |

Work split and the contract between render sections: `TEAM-PLAN.md`.

## The idea

- **Name:** L-Plate
- **One-liner:** practise driving on real UK streets from your sofa, with an AI driving instructor in the passenger seat.
- **Who it's for / what problem:** UK learner drivers. Lessons cost money, test slots are scarce, and learners can't rehearse a real test route between lessons.
- **Why it matters:** you can rehearse the real roads around your test centre, and get feedback structured like the UK practical test (minor, serious and dangerous faults, each tied to a Highway Code rule).
- **The one end-to-end demo path:** laptop opens the game and picks a real UK area, then shows a QR code. A phone scans it and becomes the controller (tilt to steer, buttons for accelerate and brake). The user drives a 3D car on real OSM roads while the AI instructor gives directions and coaching. At the end they get a mock-test report with PASS/FAIL.

## Scope

Build order (the priority list):
1. Phone-to-laptop steering via QR code + WebSocket (riskiest, first)
2. Simple 3D road and car responding to the phone
3. Real streets from OpenStreetMap (Overpass) for one cached demo area
4. Event logging + AI end-of-drive report (faults + PASS/FAIL)
5. Live instructor directions and coaching during the drive
6. Open (Nebius) vs closed (OpenAI) comparison page + chart (feedback quality, cost, latency)
7. Polish the UI for the demo

- **Must have (the demo path):** steps 1 to 4
- **Nice to have:** steps 5 to 7, Tavily lookups of Highway Code rules
- **Out of scope today:** realistic physics, traffic and pedestrians, accounts

## Stack and architecture

- **Language / framework:** TypeScript. React + Vite + Three.js (react-three-fiber) frontend, Node.js server (phone relay over WebSocket, Nebius instructor and examiner). A pnpm workspace (not `app/`): `apps/web`, `apps/server`, `packages/shared`.
- **Models** (set in `apps/server/.env`): instructor `Qwen/Qwen3-30B-A3B-Instruct-2507`, examiner `Qwen/Qwen3-235B-A22B-Instruct-2507` (JSON schema), embeddings `Qwen/Qwen3-Embedding-8B`. Why: root `DECISIONS.md`.
- **External APIs:** Nebius Token Factory; OpenStreetMap Overpass; Tavily (optional, Highway Code rules); OpenAI (comparison page only)
- **Env vars:** `apps/server/.env.example` (Nebius key and model IDs), `apps/web/.env.example` (optional Google Maps keys). Never commit `.env`.
- **Layout:**
  - `apps/web/src/sim/`: simulation core (roads, raster, city layout, vehicle, traffic, signals, sat nav, faults, session)
  - `apps/web/src/render/`: three.js parts per teammate (`city/`, `atmosphere/`, `traffic/`, `cabin/`); contract in `render/types.ts`
  - `apps/web/src/app/`: app shell (menu, drive screen, HUD); `parts.ts` picks up each render part once it's merged
  - `apps/web/public/osm/`: cached OSM extracts; `apps/web/src/routes/`: test routes and free-drive starts
  - `apps/server/src/`: relay, instructor, debrief, reroute; `packages/shared/`: message and API types; `scripts/`: data builders
- **Run locally:** `corepack enable && pnpm install`, then `pnpm --filter @lplate/server dev` (port 8080, `PORT=` to change) and `pnpm --filter @lplate/web dev` (port 5173; `SERVER_PORT=` if the server isn't on 8080). Open `http://localhost:5173/?route=goodmayes`. City-only preview (once `feat/city` is merged): `http://localhost:5173/src/render/city/preview/index.html`.
- **Test:** `pnpm typecheck`, `pnpm test` (Vitest).

## Demo plan

TBD. Use the `demo-prep` skill to write `docs/DEMO.md` once the demo path works.
