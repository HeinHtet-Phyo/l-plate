# City renderer: status and how to resume

> **Owner:** @minthantkyaw28 (TEAM-PLAN §2). **Branch:** `feat/city`. **Goal for 16:30:** Goodmayes looks like a London
> street from the driver's seat (`/?route=goodmayes`), by day, at night and in rain, without hurting the frame rate.
> **This file is the live checklist.** Any agent (Claude Code, Codex, Cursor…) can carry on from it. Update the
> status table when a part changes, then commit and push `feat/city`.

## If you're picking this up

1. `git switch feat/city && git pull --rebase` (a background job may have pushed `wip(city): auto-checkpoint` commits).
2. Read this file, then `TEAM-PLAN.md` §2 and `apps/web/src/render/types.ts`.
3. Run it: `pnpm install`, then `pnpm --filter @lplate/web dev` (port 5173) and, for the full app, `pnpm --filter @lplate/server dev` (port 8080; needs `apps/server/.env`).
   - City on its own: `http://localhost:5173/src/render/city/preview/index.html?area=goodmayes&preset=sunny&cam=eye`
     (params are documented at the top of `preview/preview.ts`: `preset`, `cam=eye|aerial|top`, `x,z,h`, `only=<part>`, `t`, `fly=1`).
   - Full app: `http://localhost:5173/?route=goodmayes&weather=sunny&voice=0` (the app picks up `render/city/index.ts` automatically through `app/parts.ts`).
4. Screenshots without a browser window: `preview/shot.mjs` (city preview) and `preview/app-shot.mjs` (full app). They need `playwright-core` and are set up as the header comment says. Always LOOK at the PNG.
5. Check: `pnpm --filter @lplate/web typecheck` must be clean before committing.
6. When every row below is done: open a PR `feat/city` → `main` for @christopherwhite06, then update your HANDOFF.md lane.

## Layout

| File | What | Contract |
|---|---|---|
| `index.ts` | `createCity(s, tex): RenderPart`; builds each part in a try/catch, so one broken part doesn't blank the city | `render/types.ts` |
| `common.ts` | `CityPiece`, `rotY`, lamp map upload, `syncShared` (sets shared uniforms from `s.conditions` each frame), GLSL `cityLight()` (day ambient + baked lamps + headlights), `cityShaderMaterial`, `withCityLight` (patches Lambert/Standard) | see `docs/DECISIONS.md` 14:10 |
| `surface.ts` | One shader for the ground: asphalt, paving, kerbs, grass/water/wood, wet roads | |
| `markings.ts` | Centre and lane lines, stop lines, give-way lines, zebras with zig-zags | |
| `buildings.ts` (+ `../textures.ts`) | Extruded walls with ground/upper facade bands, flat/slate/gable roofs, lit windows at night | |
| `props.ts` | Trees, parked cars, streetlights (instanced, distance-culled), lamp glow | exports car geometry for traffic |
| `signals.ts` | Traffic lights (aspect from `s.signals.aspect(line, s.world.time)`), Belisha beacons | |
| `preview/` | Dev page + screenshot scripts | dev only |
| `../atmosphere/uniforms.ts` | Shared uniforms stub, byte-for-byte from TEAM-PLAN (Aryaan owns it) | |

## Status

Updated: 2026-10-24 14:40 by @minthantkyaw28 (Claude Code, with one sub-agent per part).

| Part | Status | Notes / remaining |
|---|---|---|
| scaffold (`index`, `common`, preview) | done | |
| surface | built; tuning night/rain | sunny looks right (asphalt, pale kerbs, slab pavements, grass). TODO: smooth the jagged outer pavement edge; reduce the darkening next to buildings; check `preset=night`, `rain`, `night-rain`. ~30 draw calls, ~95k tris, ~50 ms build |
| markings | in progress | needs: centre dashes, lane lines, stop lines, give-way at minor roads, zebras + zig-zags |
| buildings | in progress | needs: facade bands with whole bays/storeys, gable roofs on infill terraces, night windows (45%, 85% shops) |
| props | in progress (may need a restart) | needs: instanced trees, 7,382 parked cars culled to ~350 m, 3,097 streetlights with night glow |
| signals | in progress | needs: 3-aspect UK heads at `line.head`, lens colours per frame, Belisha beacons flashing |
| integration check in the full app | not started | drive `?route=goodmayes`, check fps with cabin + mirrors, then night/rain |
| PR to main | not started | |

## Budgets

Whole city: ≤ ~80 draw calls and ≤ ~1M triangles in view, build ≤ ~1.5 s on Goodmayes (5,018 buildings, 7,382 parked cars,
3,097 lamps, 286 trees, 46 stop lines, 7 zebras). The frame also renders traffic, the cabin and one of three mirrors per frame.
