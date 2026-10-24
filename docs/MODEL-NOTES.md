# Where the open models struggled (observed while building)

Logged during development against Nebius Token Factory, 2026-10-24. These are useful for the demo.

| When | Model | What happened | What we did |
|---|---|---|---|
| Examiner debrief, kerb + missed signal | Qwen/Qwen3-235B-A22B-Instruct-2507 | Summary said "two faults that led to a fail" while `result` was "pass" (both faults marked as driving faults, so pass is correct under the DVSA rule). | Server recomputes the result from the severities with the DVSA rule and appends a correcting sentence when the model disagrees; `modelResult` is kept for the UI. |
| Examiner debrief, no rules supplied | Qwen/Qwen3-235B-A22B-Instruct-2507 | Cited "Highway Code Rule 153" for kerb strikes (Rule 153 is about traffic-calming measures). Invented rule numbers from memory. | Prompt forbids citing rules not quoted in the input; server strips "(Rule N)" citations that weren't retrieved. The Highway Code RAG lookup supplies real rules. |
| Instructor, same [SIM] input twice | Qwen/Qwen3-30B-A3B-Instruct-2507 | Second reply invented "you're at the end of the road" — a direction not in the [SIM] note. | Temperature 0.5 → 0.3; system prompt says "never invent directions". The drawn sat nav stays the source of truth. |
| Instructor latency | Qwen/Qwen3-30B-A3B-Instruct-2507 | 0.4–0.5 s for a full reply (well under the 1.5 s first-token target), so streaming wasn't needed. | Non-streaming JSON reply. |
