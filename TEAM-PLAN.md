# L-Plate: who does what (5 people, each with Claude)

**Goal for judging (16:30):** the **Goodmayes** test route drives end to end: 3D street, cabin, sat nav, Sam speaking, debrief. Other routes come afterwards.
Open `http://localhost:5173/?route=goodmayes`.

The spec is in `docs/SPEC.md`. The **§ numbers** below refer to it. Read your sections before you start. Choices already made are in `DECISIONS.md`.

| # | Person | Area | Owns (only edit these) |
|---|---|---|---|
| 1 | **Chris** | App shell, render loop, HUD, menu, integration | `apps/web/src/main.tsx`, `apps/web/src/app/**`, `apps/web/src/sim/session.ts` |
| 2 | **Min** | The city: roads, markings, buildings, trees, parked cars, streetlights, signals | `apps/web/src/render/city/**`, `apps/web/src/render/textures.ts` |
| 3 | **Hein** | Phone controller page (already claimed), then cabin, mirrors, sat nav screen, windscreen rain | `apps/web/src/phone/**`, `apps/web/src/render/cabin/**` |
| 4 | **Aryaan** | Sky, lights, weather, night, AI-traffic meshes | `apps/web/src/render/atmosphere/**`, `apps/web/src/render/traffic/**` |
| 5 | **Jai** | Tests, typecheck/build fixes, server extras, data, README, verification | `**/test/**`, `scripts/**`, `apps/server/**`, `README.md` |

Note: the app lives in `apps/web` + `apps/server` (pnpm workspace), not `app/`. Only touch files you own. If you need a change in someone else's file, message them (or Chris for `session.ts`). Work on a branch `feat/<area>` and open small PRs into `main` often; Chris merges.

---

## Setup (everyone, about 5 minutes)

```bash
git clone git@github.com:christopherwhite06/Nebius-Hack.git && cd Nebius-Hack
corepack enable && pnpm install
cp apps/server/.env.example apps/server/.env   # get NEBIUS_API_KEY from Chris privately; never commit it
```

Model values for `apps/server/.env`:
- `NEBIUS_MODEL_INSTRUCTOR=Qwen/Qwen3-30B-A3B-Instruct-2507`
- `NEBIUS_MODEL_EXAMINER=Qwen/Qwen3-235B-A22B-Instruct-2507`
- `NEBIUS_MODEL_EMBED=Qwen/Qwen3-Embedding-8B`

Run it:
- Server: `pnpm --filter @lplate/server dev` (port 8080; use `PORT=8090` if 8080 is taken).
- Web: `pnpm --filter @lplate/web dev`. If the server is on 8090, prefix with `SERVER_PORT=8090`.

**What already exists:**
- **Sim core** in `apps/web/src/sim/`: roads, raster, signals, city layout, vehicle, world, traffic, sat nav, faults, coach, conditions, session.
- **Server:** pairing relay, Nebius instructor and debrief, reroute endpoint.
- **Data:** every OSM extract in `apps/web/public/osm/` (Belvedere came back empty and needs a refetch), plus `apps/web/src/routes/test-routes.json`.

None of it has been typechecked yet. Expect small compile errors and fix any in files you own.

## The contract between sections (code against this, don't wait for each other)

Every render module exports a factory with the same shape:

```ts
// apps/web/src/render/types.ts — Chris creates this first (5 min)
import type * as THREE from 'three';
import type { Session } from '../sim/session.ts';
export interface RenderPart {
  object: THREE.Object3D;               // added to the world scene by Chris
  update(s: Session, dt: number): void; // called every frame after session.step(dt)
  dispose(): void;
}
```

| Factory | Owner | File |
|---|---|---|
| `createCity(s: Session, tex: TextureSet): RenderPart` | Min | `render/city/index.ts` |
| `createAtmosphere(s: Session): RenderPart & { apply(scene: THREE.Scene, gl: THREE.WebGLRenderer): void }` (sets fog, exposure and tone mapping each frame) | Aryaan | `render/atmosphere/index.ts` |
| `createTraffic(s: Session): RenderPart` | Aryaan | `render/traffic/index.ts` |
| `createCabin(s: Session): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update(s: Session, dt: number, worldCam: THREE.Camera): void; renderMirrors(gl: THREE.WebGLRenderer, world: THREE.Scene, frame: number): void }` | Hein | `render/cabin/index.ts` |

**Shared night/weather uniforms** live in `render/atmosphere/uniforms.ts`. Aryaan commits this exact stub **in the first 10 minutes**; Min's shaders read it, and Aryaan drives the values each frame:

```ts
import * as THREE from 'three';
export const shared = {
  uDay: { value: 1 }, uOvercast: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 },
  uLampMap: { value: null as THREE.Texture | null }, uLampScale: { value: new THREE.Vector2(1, 0) }, // uv = (xz + radius) / (n·cell)
  uCarPos: { value: new THREE.Vector3() }, uCarDir: { value: new THREE.Vector2(0, -1) }, uSkyColour: { value: new THREE.Color() },
};
```

**What a session gives you** (`apps/web/src/sim/session.ts`, already written). Everything is in local metres: x is east, z is south, y is up, north is −z.

| Field | What it holds |
|---|---|
| `s.world.car` | `x`, `z` (the eye), `heading` (compass degrees), `speed` (m/s), `steer`, `handbrake` |
| `s.world.bodyRise`, `s.spring.y`, `s.pitch`, `s.rumble` | Body and camera motion |
| `s.buildings` | `PlacedBuilding[]`: footprint `pts`, height `h`, `storeys`, `style`, `shopfront`, `roof`, `ridge`, `tint` |
| `s.parked`, `s.trees`, `s.lamps` | Parked cars, trees and streetlights |
| `s.lightMap` | Baked streetlight raster: `n`, `cell`, `data` |
| `s.grid` | `AreaGrid`: `n`, `cell`, `radius`; `rgba()` gives R = carriageway, G = pavement, B = building |
| `s.land` | `LandCover` raster: `n`, `cell`, `data` (RGBA = grass, water, wood) |
| `s.net` | `RoadNetwork`: `segs`, `junctions`, `laneInfo(seg, forward)` |
| `s.signals` | `lines` (stop lines with a `head` position), `zebras`, `aspect(line, s.world.time)` |
| `s.traffic.cars` | Each car has smoothed pose `rx`, `rz`, `rh`, plus `braking` and `colour` |
| `s.conditions` | `daylight`, `cloud`, `rain`, `fog`, `sunElevation`, `sunAzimuth`, `hour` |
| `s.nav` | `state` (next step, distance, status), `tracker.pts` (route polyline in metres) |
| `s.indicator`, `s.indicatorLit`, `s.time` | Indicator state and session clock |
| `s.snapshot` | The HUD snapshot; subscribe to it with `useSyncExternalStore(s.subscribe, s.getSnapshot)` |

---

## 1. Chris: app shell, render loop, HUD, menu (§2, §7.1, §14.4, §15, §16)

1. **First 5 minutes:** create `render/types.ts` (above) and push it, then:
   - `src/main.tsx`: no `<StrictMode>`. Lazy-load by path: `/c/:session` loads the phone page, everything else loads the app.
   - `app/Menu.tsx`: route cards ("typical, not official"), free-drive cards, conditions presets, QR code via `qrcode` + `HostLink`, instructor toggle in localStorage, GPU status, Start button.
   - `app/Drive.tsx`: load extract → `new Session(setup)` → `build(progress)` → R3F `<Canvas dpr={stateDpr}>`, with these camera settings:
     - horizontal FOV 100° (compute the vertical FOV from the aspect ratio)
     - `rotation.order = 'YXZ'`, `rotation.y = −heading`
     - eye height 1.2 m + `bodyRise` + `spring.y`
2. **Render loop** in `useFrame(…, 1)`, in this order:
   1. `dt = min(0.05, elapsed)`, then `session.step(dt)`.
   2. `city.update`, `traffic.update`, `atmosphere.update`, `atmosphere.apply(scene, gl)`, `cabin.update`.
   3. `cabin.renderMirrors(gl, scene, frame)`.
   4. `gl.autoClear = false; gl.clear(); gl.render(scene, cam); gl.clearDepth(); gl.render(cabin.scene, cabin.camera)`.
3. **HUD** (`app/Hud.tsx`, via `useSyncExternalStore`):
   - place panel, toasts, hints and Sam's caption
   - conditions chip, attribution, help (H), debug panel (`)
   - a **"Finish lesson"** button that calls `session.finish()`; the route is 3.5 miles, so the demo needs it
   - lesson summary showing the debrief
   - push-to-talk text box when there's no speech recognition
4. **GPU and resolution:** `sim/gpu.ts` provides `detectGpu` and `AdaptiveDpr`. Keep the dpr in React state (§15).
5. URL shortcuts (§16).
6. **Integrate the PRs as they land.** Get `?route=goodmayes` working first with placeholder boxes if the city isn't in yet.

## 2. Min: the city (§5.3, §6.1–6.4, §6.6, §6.7)

Build `render/city/index.ts` → `createCity(s, tex)`:

- **Road surface** (§5.3): one big plane subdivided into roughly 12 m tiles.
  - The shader samples `s.grid.rgba()` as a texture: linear filtering with mipmaps for looks, but `textureLod(…, 0.0)` for discard decisions.
  - Asphalt and paving use the textures from `textures.ts` (they already exist).
  - Pale kerb band where carriageway coverage crosses 0.5 next to pavement; wet darkening plus Fresnel when `uRain > 0`.
  - Night lighting: `light = 0.1 + 0.9·day·(1 − 0.35·overcast)` + `lampColour·lampMap·2.0` + headlight beam (§13).
- **Ground plane** from `s.land` (grass, water or paving).
- **Markings** quad mesh, 3 cm above the surface with polygon offset:
  - dashed centre lines; lane lines
  - stop lines (from `s.signals.lines`)
  - give-way double dashes at minor-road mouths
  - zebras with zig-zags
- **Buildings** (§6.2): extrude `s.buildings` and normalise winding.
  - Two texture bands: ground floor 9 m × 3.9 m, upper 9 m × 9 m. `textures.ts` already has both, per style.
  - One merged mesh per style band, with per-vertex tint.
  - Gabled roofs for `roof === 'gable'` (the infill houses); slate or flat roofs otherwise.
  - Lit windows at night (§6.5) via `onBeforeCompile`: about 45% of dark-glass cells, 85% for shopfronts.
- **Trees, parked cars and streetlights:** instanced meshes from `s.trees`, `s.parked` and `s.lamps`. Lamp heads glow at night, with additive sprites.
- **Traffic lights** (three-aspect heads at `line.head`, lamp colours from `s.signals.aspect`) and **Belisha beacons** at `s.signals.zebras`.

**Done when** Goodmayes looks like a London street: brick houses (including infill), parked cars, lights and markings.

## 3. Hein: phone controller, then cabin, mirrors, sat nav screen (§8, §9, §11, §12)

**Phone first (you already claimed it).** Build it inside this workspace, not in a separate `app/` folder.
- **Where:** `apps/web/src/phone/PhonePage.tsx`, served at `/c/:session?t=…`.
- **Already done:** the relay (`apps/server/src/relay.ts`, `POST /api/pair`, `GET /ws`), the host side (`apps/web/src/net/pairing.ts`) and the tilt maths (`apps/web/src/phone/tilt.ts`).
- **Still to do:** the page itself:
  - landscape wheel, analogue pedals, indicator stalks that blink with the car
  - handbrake, recover and recentre buttons
  - the iOS `DeviceOrientationEvent.requestPermission()` tap, and touch-drag steering as the fallback
  - WebSocket `role=controller`, sending `controls` at ~30 Hz plus `sensor` status
- **Message types:** `ControllerMessage` and `HostMessage` in `packages/shared/src/index.ts`.

Then the cabin:

Build `render/cabin/index.ts` → `createCabin(s)`:

- **Cabin geometry** (§8): procedural right-hand-drive interior in eye-relative coordinates, drawn in the second pass with near = 0.02.
  - dashboard, binnacle, A-pillars, roof lining, sun visor
  - the bonnet, visible through the windscreen
  - a steering wheel that turns with `car.steeringWheelAngle()`
- **Instrument cluster:** canvas texture with speedo, rev counter, digital mph, indicator arrows (`s.indicatorLit`) and a handbrake light.
- **Mirrors** (§9): three cameras and half-float render targets with 4× MSAA, using the exact positions and FOVs from the spec. Flip with `repeat = (−1, 1)` and `offset = (1, 0)`. Update only one mirror per frame. `?mirrors=0` turns them off.
- **Sat nav screen** (§11): a 768 × 360 canvas on a 0.29 × 0.136 m screen.
  - left panel: arrow or roundabout icon plus the distance (`s.snapshot.nav`)
  - instruction bar, ETA and miles left
  - heading-up route map from `s.nav.tracker.pts`
  - amber when off route; free drive shows the road name and time
- **Windscreen rain** (§8): shader drops plus two wipers sweeping every 1.4 s while `s.conditions.rain > 0`.
- **Optional, last:** the Google map overlay (§11) with the matrix3d homography, which is already in `sim/geo.ts` as `quadMatrix3d`.

## 4. Aryaan: atmosphere and traffic meshes (§10, §13)

1. **First 10 minutes:** commit the `render/atmosphere/uniforms.ts` stub above.
2. **`createAtmosphere(s)`** (§13):
   - **Sky dome:** day/overcast/sunset/night gradient, sun disc, stars.
   - **Lights:** hemisphere, sun and moon, using the formulas in §13. ACES tone mapping, with exposure `0.85 + 0.2·day`.
   - **Fog:** `FogExp2` with density from visibility.
   - **Rain:** about 7,000 GPU line streaks in a box that follows the camera.
   - **Each frame:** update the `shared` uniforms, including the light map texture from `s.lightMap` (single channel, `unpackAlignment = 1`).
3. **Live weather:** `fetchOpenMeteo` and the presets are already in `sim/conditions.ts`. Refresh every 10 minutes and write into `s.conditions`.
4. **`createTraffic(s)`:** instanced car bodies, glass and wheels for up to 130 cars from `s.traffic.cars` (`rx`, `rz`, `rh`). Brake lights come on when `braking`; headlights and tail lights glow at night.
5. **Optional:** live Google traffic, via `Traffic.applySpeedBands` (already written).

## 5. Jai: tests, build, server extras, data, docs (§17, §19, §21)

1. **First:** run `pnpm typecheck` and fix errors in `apps/server` and `scripts`. Report errors in other people's files to their owners.
2. **Vitest suites** (§19), in `apps/web/test/` and `apps/server/test/`:
   - geo and the homography
   - road network and raster
   - signals timing and the city layout
   - RoadWorld and vehicle
   - traffic
   - conditions
   - sat nav
   - tilt and the relay
   - instructor: mocked fetch, schema validation and fallback
   - GPU name parsing
3. **Data:**
   - Refetch Belvedere: `pnpm osm:fetch belvedere --force` (it came back with 0 elements).
   - Spot-check counts for the other areas.
4. **Scripts and docs:**
   - `scripts/scan-secrets.ts` (§17): runs over the git history and the index.
   - `scripts/build-rules.ts`: Highway Code → embeddings JSON at `apps/server/data/highway-code.json` (§14.3). The server's `rules.ts` already reads it.
   - `README.md`: setup, scripts, credits.
5. **Last 30 minutes:** run the §21 checks on Goodmayes in headless Chrome on the real GPU (§18) and post screenshots for the demo.

## Demo story (for whoever presents)

1. **Pitch:** lessons cost £40–50 an hour and learners need 40+ hours.
2. **Drive:** Goodmayes, a real test centre route. Sam (Nebius, Qwen3-30B) speaks the directions and picks up faults; finish with the Nebius examiner debrief (Qwen3-235B, JSON schema).
3. **Where the models struggle:** `docs/MODEL-NOTES.md`. The examiner contradicted its own pass/fail, it invented Highway Code rule numbers, and Sam once made up a direction. The server now guards against all three.
