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
