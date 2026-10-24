# City renderer scaffold and coordination: @minthantkyaw28: 2026-10-24 13:58–15:47

- **Agent:** Claude Code (Opus), with five sub-agents (one per city part). Codex finished the parts after Claude hit its usage limit (see `2026-10-24-1420-minthantkyaw28-finish-city-renderer.md`).

## Done
- Claimed TEAM-PLAN §2 and built the scaffold on `feat/city`: `render/city/index.ts` (`createCity`, each part built in a try/catch), `common.ts` (lamp map upload, `syncShared`, the `cityLight()` GLSL, `cityShaderMaterial`, `withCityLight`), `render/atmosphere/uniforms.ts` (the TEAM-PLAN stub), and the dev preview `render/city/preview/` with `shot.mjs` / `app-shot.mjs` screenshot scripts.
- Set up `apps/server/.env` from the root `.env` key (gitignored).
- Docs on `main`: Blockers asking Chris for `docs/SPEC.md` and flagging the split logs; copied `docs/MODEL-NOTES.md` into `docs/MODEL_FAILURES.md`; logged the lamp map and shared-uniform conventions in `docs/DECISIONS.md`; updated `docs/PROJECT.md` to the pnpm `apps/` layout.
- Resume mechanism: `render/city/README.md` status table + `preview/checkpoint.sh` (pushes WIP every 8 min). Codex resumed from it and finished; PR #1 was merged.
- Re-checked on `main` at 15:45: `pnpm --filter @lplate/web typecheck` clean; `/?route=goodmayes` by day and at night renders the city with Aryaan's atmosphere and Hein's cabin. City build ≈ 170–270 ms. Aryaan's atmosphere uses the same lamp map convention (`scale = 1/(n·cell)`, `offset = radius·scale`).

## Notes
- The laptop disk was nearly full (≈ 540 MB free) and stopped a sub-agent; `npm cache clean --force` freed it to ~4 GB.
- `docs/SPEC.md` is still not in the repo (blocker left on the board).

## Next (optional polish)
- Night: buildings look bright and lit windows are hard to see; tune `withCityLight` strength or the window emissive in `buildings.ts`.
- `render/atmosphere/index.ts:130`: the lamp map DataTexture defaults to NearestFilter; LinearFilter would smooth the light pools (Aryaan's file).
