---
name: demo-prep
description: >-
  Turns the team's repo memory into the hackathon demo: a three-minute script in docs/DEMO.md, the
  "where models struggle" evidence, and a pre-judging checklist. Use when the user mentions the demo,
  pitch, judging, presentation, slides, submission or "what should we show"; when deciding what to
  cut before judging; and from about 15:30 on hackathon day.
---

# Demo prep

**Judging starts 16:30.** Judges want *a working example with a clear purpose*. The demo must show **what it does**,
**where the models struggle**, and **why it matters** (see the token-factory skill's hackathon brief).

## Inputs: read these, don't invent

- `docs/PROJECT.md`: the idea, the user, why it matters, the demo path.
- `HANDOFF.md` Snapshot: what *actually* works end-to-end right now.
- `docs/MODEL_FAILURES.md`: entries marked **Demo-worthy: yes** are the struggle story.
- `docs/DECISIONS.md`: trade-offs worth a sentence.
- Any model-comparison results (see "Comparing models" in the token-factory skill).

If the demo path doesn't work yet, say so plainly and help cut scope to something that will by 16:15.

## Output: `docs/DEMO.md`

1. **Hook (about 15 s):** the problem and who has it, in one or two sentences.
2. **Live demo (about 90 s):** the one end-to-end path. List the exact inputs to type or click and the expected output.
   Every step that calls a model needs a **fallback** (a screen recording or screenshots) in case of latency or a 429.
3. **Where models struggle (about 45 s):** 2–3 concrete failures from `MODEL_FAILURES.md`, with model IDs, how often
   they happened, and what we did about each one. A small table or chart beats prose.
4. **Why it matters (about 20 s).**
5. **What's next (about 10 s).**
6. **Roles:** who talks, who drives the laptop, who watches the clock.

Only claim what works. Something flaky can be shown as a *struggle*. Don't hide it, and don't fake it.

## Pre-judging checklist (put it at the bottom of `docs/DEMO.md`)

- [ ] A fresh clone with `.env` runs using the command documented in `docs/PROJECT.md` / `README.md`.
- [ ] The demo inputs work three times in a row and the latency is acceptable.
- [ ] Fallback recordings or screenshots exist and are on the demo laptop.
- [ ] Teammates stop load-testing on the shared API keys during judging.
- [ ] Nothing secret is on screen: `.env`, terminal history, dashboards with keys.
- [ ] `README.md` says what the project is and how to run it. The final code is pushed to `main`.
