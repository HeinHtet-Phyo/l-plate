# HANDOFF

> Live status board. Every agent reads it at the start of a session and updates it before stopping.
> **Edit only your own lane.** In the shared sections, change single lines; don't reorder or rewrite.
> Keep this file under ~150 lines. Details belong in `docs/sessions/`.

Last updated: 2026-10-24 13:58 by @minthantkyaw28

## Snapshot

- **Idea:** L-Plate, a driving-practice game on real UK streets with an AI instructor. See `docs/PROJECT.md`.
- **Works end-to-end:** nothing yet (no app code).
- **Repo has:** the shared agent memory system (AGENTS.md, this board, `docs/`, workflow skills, session-start hook), tool-neutral
  in `.agents/` with adapters for Claude Code (`.claude/`) and Cursor (`.cursor/`), plus Token Factory, Nebius and Tavily skills.
- **Keys verified live (2026-10-24):** Token Factory (29 serverless models, chat/tools/JSON/vision/embeddings OK, no image
  generation) and Tavily (search + extract OK). See `docs/MODEL_FAILURES.md` for what broke.
- **Judging:** 16:30 today.

## Up next (unclaimed)

<!-- To claim a task, move it into your lane and push right away (/claim). Add new tasks at the bottom. -->
- [x] (done by @christopherwhite06, all 9 areas in `apps/web/public/osm/`) L-Plate step 3: fetch one demo area's roads from OSM Overpass (names, maxspeed, junctions, roundabouts) and cache it as JSON in `app/public/areas/`.
- [x] (server side done by @christopherwhite06: `/api/debrief`, `sim/faults.ts`) L-Plate step 4: driving event logger + end-of-drive mock-test report via Token Factory (minor/serious/dangerous faults, PASS/FAIL, Highway Code rule per fault).
- [x] (server + coach done by @christopherwhite06: `/api/instructor`, `sim/coach.ts`) L-Plate step 5: live instructor directions and coaching during the drive.
- [ ] L-Plate step 6: open (Nebius) vs closed (OpenAI) comparison page with a quality/cost/latency chart.
- [ ] **Everyone: read `TEAM-PLAN.md` for your section.** Then put `NEBIUS_API_KEY` (and `TAVILY_API_KEY`) in `.env`, run the `/v1/models` check from the token-factory skill, and `uv tool install tavily-cli` (see README).
- [ ] Build a small model-comparison harness for the "where models struggle" part of the demo (see token-factory skill).

## Lanes

### @minthantkyaw28
- **Status:** in progress
- **Working on:** TEAM-PLAN §2, the city renderer: `createCity(s, tex)` in `apps/web/src/render/city/**` (road surface shader, markings, buildings, trees, parked cars, streetlights, traffic lights, Belisha beacons) + `render/textures.ts`
- **Next:** PR `feat/city` into main for Chris to merge; Goodmayes should look like a London street
- **Branch:** feat/city
- **Updated:** 2026-10-24 13:58
- **Log:** `docs/sessions/2026-10-24-1133-minthantkyaw28-agent-memory-system.md`

### @christopherwhite06
- **Status:** in progress. Pushed the L-Plate base: pnpm workspace (`apps/web`, `apps/server`, `packages/shared`), OSM data for all 9 areas + 5 test routes, server (phone relay, Nebius instructor + examiner debrief, reroute), browser sim core. **Work split: `TEAM-PLAN.md`.**
- **Working on:** app shell, render loop, HUD, menu, integration (TEAM-PLAN §1). Target: `?route=goodmayes` end to end by 16:30.
- **Next:** merge Min/Hein/Aryaan/Jai PRs as they land
- **Branch:** main
- **Updated:** 2026-10-24 14:05
- **Log:** `DECISIONS.md`, `docs/MODEL-NOTES.md`

### @HeinHtet-Phyo
- **Status:** phone page and cabin done on branch `hein`, typechecked and rendered on Goodmayes (sunny, rain, night) with a local harness. Not in `main` yet.
- **Working on:** nothing; ready for integration
- **Next:** Chris: (1) lazy-load `apps/web/src/phone/PhonePage.tsx` (default export) for `/c/*`; (2) `import { createCabin } from './render/cabin/index.ts'` and follow the TEAM-PLAN render loop (`cabin.update(s, dt, worldCam)`, `cabin.renderMirrors(gl, scene, frame)`, then a second pass after `clearDepth`). Merge `hein` into `main`, or tell me to open a PR. Optional: Google map overlay (§11).
- **Branch:** `hein`
- **Updated:** 2026-10-24 14:05
- **Log:** `docs/sessions/2026-10-24-1325-HeinHtet-Phyo-phone-controller.md`

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
