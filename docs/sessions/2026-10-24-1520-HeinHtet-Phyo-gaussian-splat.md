# 2026-10-24 15:20 · @HeinHtet-Phyo · Elephant & Castle Gaussian splat

## Done
- Merged `origin/main` into `hein` and picked up `splat.md` (Chris's hand-off) and `apps/web/public/osm/elephant-splat.json` (origin 51.498455, −0.107231).
- Claimed the work in the `HANDOFF.md` lane (commit `c53c24a` on `hein`).
- Set up `~/lplate-splat/.venv` (Python 3.12, pycolmap 4.2.1, numpy, plyfile) and Brush v0.3.0 for Apple Silicon at `~/lplate-splat/brush-app-aarch64-apple-darwin/brush_app`.
- Ran parallel agents for: (1) data and training (photos, SfM, Brush, alignment), (2) app wiring (Spark renderer, `splat.ts`, `Drive.tsx`, `session.ts`), (3) a fallback imagery source, (4) a Brush smoke test.

## Problems
- **Panoramax unreachable from the venue network.** `api.panoramax.xyz` resolves (193.200.42.124). TCP to `:443` connects (`nc -vz` succeeds), but HTTPS and HTTP requests hang until they time out (`curl` gives `000` after 30–40 s; Python `URLError: timed out`). The same happened with `panoramax.openstreetmap.fr`. `panoramax.ign.fr` answers, but it doesn't host this collection (404 "Collection doesn't exist"). GitHub and openstreetmap.org work fine.

## Pipeline (paths)
| Step | Output |
|---|---|
| Photos + GPS | `~/lplate-splat/elephant/images/`, `~/lplate-splat/elephant/frames.json` (outside the repo) |
| SfM | `~/lplate-splat/elephant/sparse/0` (registered images: _pending_ / _pending_) |
| Training | Brush on Apple M5, _pending_ steps, _pending_ splats |
| Splat for the web | `apps/web/public/splats/elephant-splat/scene.ply` or `.spz` (_pending_ MB, must be < 95 MB) |
| Placement | `apps/web/public/splats/elephant-splat/transform.json` (GPS RMS _pending_ m, camera height _pending_ m) |

## Next
- If Panoramax stays down, use the fallback imagery source (or try another network, e.g. a phone hotspot) and keep the CC BY-SA credit correct for whatever source is used.
- Drive `http://localhost:5173/?start=elephant-splat&weather=sunny`. Check that the car sits on the splat's road in the left lane. If it's rotated, check `det` in `align.py`. If it's floating, adjust `M[1,3]`.
- Run `node scripts/scan-secrets.ts --staged`, commit `feat(splat): …` to `hein`, push, and tell Chris to pull it onto the demo laptop.
