# HANDOFF

> Live status board. Every agent reads it at the start of a session and updates it before stopping.
> **Edit only your own lane.** In the shared sections, change single lines; don't reorder or rewrite.
> Keep this file under ~150 lines. Details belong in `docs/sessions/`.

Last updated: 2026-10-24 14:28 by @jai-matharu

## Snapshot

- **Idea:** L-Plate, a driving-practice game on real UK streets with an AI instructor. See `docs/PROJECT.md`.
- **Works end-to-end:** Goodmayes drives in the full app with the city, cabin, mirrors, phone controls, live instructor and AI debrief; city PR #1 awaits merge.
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
- **Status:** done; **merged into `main`** by @christopherwhite06.
- **Working on:** nothing
- **Next:** @christopherwhite06 merges https://github.com/christopherwhite06/Nebius-Hack/pull/1, then run the final merged-device performance/demo pass.
- **Branch:** feat/city
- **Updated:** 2026-10-24 14:23
- **Log:** `docs/sessions/2026-10-24-1420-minthantkyaw28-finish-city-renderer.md`

### @christopherwhite06
- **Status:** in progress. App shell done and pushed: menu, drive screen (two-pass render loop, adaptive dpr), HUD, lesson summary with Nebius debrief, phone QR panel. `?route=goodmayes` drives end to end at 60 fps with fallback visuals; your render modules replace the fallbacks automatically when merged (`apps/web/src/app/parts.ts`).
- **Working on:** integration and polish; merging your PRs. Run it: server `PORT=8090 pnpm --filter @lplate/server dev`, web `SERVER_PORT=8090 pnpm --filter @lplate/web dev -- --port 5174`.
- **Next:** merge Min/Hein/Aryaan/Jai PRs as they land
- **Branch:** main
- **Updated:** 2026-10-24 15:10
- **Log:** `DECISIONS.md`, `docs/MODEL-NOTES.md`

### @HeinHtet-Phyo
- **Status:** phone page and cabin done; **merged into `main`** by @christopherwhite06 (picked up automatically via `app/parts.ts` and `main.tsx`).
- **Working on:** nothing; ready for integration
- **Next:** Chris: (1) lazy-load `apps/web/src/phone/PhonePage.tsx` (default export) for `/c/*`; (2) `import { createCabin } from './render/cabin/index.ts'` and follow the TEAM-PLAN render loop (`cabin.update(s, dt, worldCam)`, `cabin.renderMirrors(gl, scene, frame)`, then a second pass after `clearDepth`). Merge `hein` into `main`, or tell me to open a PR. Optional: Google map overlay (§11).
- **Branch:** `hein`
- **Updated:** 2026-10-24 14:05
- **Log:** `docs/sessions/2026-10-24-1325-HeinHtet-Phyo-phone-controller.md`

### @Aryaan2303
- **Status:** in progress. `createAtmosphere(s)` (sky dome, sun/moon/hemisphere lights, ACES tone mapping, FogExp2, 7k-streak rain, live Open-Meteo weather refresh every 10 min) and `createTraffic(s)` (instanced bodies/glass/wheels/head-tail lights for up to 130 cars) built in `apps/web/src/render/atmosphere/`, `apps/web/src/render/traffic/`. Also pushed the shared `render/types.ts` contract and `render/atmosphere/uniforms.ts` stub that were missing, so Min's city shaders and the rest of the render loop have something to compile against.
- **Working on:** verifying a standalone smoke-test render before opening the PR (no app shell/render loop exists yet to test against end to end — that's Chris's TEAM-PLAN §1).
- **Next:** open PR into main once smoke test passes; then optionally wire `Traffic.applySpeedBands` for live Google traffic (optional per TEAM-PLAN §4).
- **Branch:** feat/atmosphere-traffic
- **Updated:** 2026-10-24 14:20
- **Log:** `docs/sessions/2026-10-24-1420-Aryaan2303-atmosphere-traffic.md`

### @jai-matharu
- **Status:** in progress. Done: typecheck clean; Vitest 85 web + 44 server tests (`pnpm test`); `scripts/scan-secrets.ts`; `scripts/build-rules.ts` + `apps/server/data/highway-code.json` (307 rules); README; first headless Goodmayes check passed (M1 GPU, Sam speaking).
- **Working on:** Belvedere OSM refetch + per-area stats (`scripts/osm-stats.ts`)
- **Next:** final §21 headless checks + screenshots in the last 30 min. Known bug for sim owner: `friendlyGpuName` splits on commas inside "(radeonsi, …)" (test marked `.fails`).
- **Branch:** jai (PR into main)
- **Updated:** 2026-10-24 14:28
- **Log:** `docs/MODEL_FAILURES.md` (Sam "Good morning" at 14:11; weak short-query retrieval; Token Factory 503 outage 14:27)

## Blockers / questions for the humans

<!-- Format: - [@who] question or blocker (since HH:MM) -->
- [@minthantkyaw28] @christopherwhite06: `docs/SPEC.md` isn't in the repo, but every § number in `TEAM-PLAN.md` points to it. Please push it (since 14:08)
- [@minthantkyaw28] @christopherwhite06: notes are splitting in two. Root `DECISIONS.md` vs `docs/DECISIONS.md`, and `docs/MODEL-NOTES.md` vs `docs/MODEL_FAILURES.md` (the `demo-prep` skill reads the `docs/` ones). I copied the 4 MODEL-NOTES failures into `docs/MODEL_FAILURES.md`; please log new ones there (since 14:08)
