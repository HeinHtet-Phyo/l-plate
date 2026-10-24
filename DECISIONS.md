# Decisions (choices the build prompt left open)

- **Models (from `/v1/models?verbose=true`, 2026-10-24):** no `-fast` flavours are listed. Instructor: `Qwen/Qwen3-30B-A3B-Instruct-2507` (non-reasoning, 0.4–0.5 s full reply, so replies aren't streamed). Examiner: `Qwen/Qwen3-235B-A22B-Instruct-2507` (supports `structured_outputs`). Embeddings: `Qwen/Qwen3-Embedding-8B`.
- **Generated textures (overrides the spec's no-Gemini rule, at Chris's request, 2026-10-24):** Nebius lists no `text->image` model, so `pnpm textures:generate` uses a Gemini image model (`gemini-3.1-flash-image`, `GEMINI_API_KEY` in the gitignored root `.env`) offline only. Every image is reviewed by a Nebius vision model (`Qwen/Qwen3.8-27B`, JSON verdict) and regenerated up to 4 times. Outputs are committed under `apps/web/public/textures/`; the app has no Gemini code or dependency at runtime and falls back to procedural textures. First run blocked: the Gemini billing account hit its monthly spending cap.
- **Privacy:** Token Factory stores prompts and outputs by default. Switch on Zero Data Retention for the organisation before sending real learner data. No names are sent in prompts.
- **Debrief:** the server recomputes pass/fail with the DVSA rule and strips Highway Code rule numbers that weren't retrieved (see docs/MODEL-NOTES.md).
- **Faults:** red lights (serious) and collisions (dangerous) are logged as faults as well as the four in §14.1.
- **Overpass:** added `maps.mail.ru` as a fourth mirror, because all three listed mirrors were overloaded.
- **Sidewalk edge:** when a sidewalk has no width tag, its half-width is taken as 1.2 m.
- **Junctions:** a node is a junction when its graph degree is ≥ 3 (way end = 1, pass-through = 2), so two ways joined end to end don't make a junction box.
- **Server build:** runs from TypeScript source with Node's type stripping, so `build` is a typecheck.
- **Ports:** another local project (`~/orca/L-Plate`) currently holds 8080 and 5173. The server honours `PORT` for side-by-side testing.

# Build status (stopped at the usage limit)

Done:
- workspace and data scripts
- free-drive OSM extracts (4 of 9)
- test-route JSON, still being built by `pnpm build:routes` when the session stopped
- server: pairing relay, `/api/instructor`, `/api/debrief`, `/api/route`, `/api/config`, rules search
- sim core in apps/web/src/sim: geo, roads, raster, signals, city, vehicle, world, conditions, satnav, faults, coach

Not started:
- `pnpm osm:fetch` for the 5 route corridors
- traffic, input, GPU detection
- all three.js rendering (scene, cabin, mirrors, sky, rain)
- React UI (menu, HUD, phone page, summary)
- speech, tests, Highway Code build script, secret scan, README
- typecheck/test/build have not been run yet

# Changes requested on the day (override the spec)

- **Reverse gear** (spec said "no reverse"): G on the keyboard or the phone's Reverse button, only when stopped; capped about 11 mph; creeps backwards like an automatic. The phone receives `gear` in its state.
- **Phone steering is gyro-only:** the phone's motion sensors (orientation fusion, gyro + accelerometer) are the wheel; touch-drag steering was removed. Without motion sensors (desktop, or plain HTTP) the phone can't steer, so use `pnpm tunnel` (HTTPS) for phones.
- **Goodmayes extract widened to a 600 m corridor** (spec: 300 m) so wrong turns stay on the map: 815 roads and 2,102 buildings, radius 1,750 m. Still 60 fps. Refetch with `pnpm osm:fetch goodmayes --force --corridor=600`.
- **Generated textures only for Goodmayes' styles** (to save the Gemini budget): Victorian red, Georgian brick, stucco, modern flats, Portland stone, warehouse brick (upper + ground floors), shopfront, slate, flat roof, asphalt, paving. Office glass stays procedural.
- **Instructor fallback model:** if `NEBIUS_MODEL_INSTRUCTOR` fails (Nebius returned 503s for it), the server retries once, then uses `NEBIUS_MODEL_INSTRUCTOR_FALLBACK` (default `deepseek-ai/DeepSeek-V4-Flash-0731`).
