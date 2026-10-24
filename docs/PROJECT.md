# Project brief

> This file is the source of truth for **what** we're building. Update it whenever the idea, scope, stack,
> layout or run commands change, and log the *why* in `DECISIONS.md`. Replace each "TBD" as soon as it's known.

## Hackathon

- **Event:** Noetic x Nebius hackathon, a one-day build (2026-10-24). **Judging starts 16:30.**
- **What judges want:** a working example with a clear purpose. The demo must show
  1. **what it does**,
  2. **where the models struggle** (evidence comes from `docs/MODEL_FAILURES.md`),
  3. **why it matters**.
- **Constraint:** models run on Nebius Token Factory (see `.claude/skills/token-factory/SKILL.md`).

## Team

| GitHub | Focus |
|---|---|
| @minthantkyaw28 | TBD |
| @christopherwhite06 | TBD |
| @HeinHtet-Phyo | TBD |
| @Aryaan2303 | TBD |
| @jai-matharu | TBD |

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

- **Language / framework:** JavaScript. React + Vite + Three.js (react-three-fiber) frontend, Node.js + `ws` relay server. Everything is in `app/`, which is one npm package.
- **Models** (keep the IDs in one config constant, e.g. `config.py` / `config.ts`): TBD. A fast open model on Token Factory for the live instructor.
- **External APIs:** Nebius Token Factory; OpenStreetMap Overpass; Tavily (optional, Highway Code rules); OpenAI (comparison page only)
- **Env vars:** see `.env.example`
- **Layout:** TBD (list the top-level folders as they appear)
- **Run locally:** TBD
- **Test:** TBD

## Demo plan

TBD. Use the `demo-prep` skill to write `docs/DEMO.md` once the demo path works.
