# Model failures log

> **This is demo material.** Judges want to see *where the models struggle*. Log every notable failure the
> moment it happens, even when you've already worked around it: wrong or missing tool calls, invalid JSON,
> hallucinated facts or sources, ignored instructions, refusals, slow responses, timeouts, 429s.
>
> **Append-only.** Add new entries at the bottom and end each one with a blank line. Never edit someone else's entry.
> Never paste API keys or `.env` contents.
>
> Format:
>
> ```
> ## YYYY-MM-DD HH:MM: <model-id>: <one-line symptom> (@handle)
> - **Task:** what we asked it to do (short prompt/tool summary; link `file:line`)
> - **Expected:** …
> - **Got:** short excerpt of the actual output or error
> - **How often:** e.g. 1/1, 3/10 runs
> - **Cost:** latency / tokens if relevant
> - **Workaround:** what we changed (prompt, model, guided_json, retries…) or "none yet"
> - **Demo-worthy:** yes / no
> ```

## 2026-10-24 12:11: deepseek-ai/DeepSeek-V4-Flash-0731: empty content with strict json_schema (@minthantkyaw28)
- **Task:** extract a support ticket (`issue_type`, `urgency` low|medium|high, `summary`) with
  `response_format={"type": "json_schema", "json_schema": {..., "strict": true}}`, temperature 0.1, max_tokens 800.
- **Expected:** a JSON object matching the schema.
- **Got:** `content: ""` after 5.5 s. Same prompt and settings with `openai/gpt-oss-120b` returned valid JSON in 0.6 s.
- **How often:** 1/5 runs. The 4 reruns returned valid JSON in about 1.7 s with finish=stop and about 131 output tokens.
- **Cost:** reasoning burns most of the tokens. `reasoning_effort="none"` gave valid JSON in 0.6 s with 38 tokens.
- **Workaround:** always validate (Pydantic) and retry once on empty or invalid output. Prefer `gpt-oss-120b` for extraction,
  or set `reasoning_effort="none"` when the task doesn't need thinking.
- **Demo-worthy:** yes. It's a flaky failure that only validation catches, plus a 3× latency and token cut from turning reasoning off.

## 2026-10-24 12:11: black-forest-labs/flux-schnell: image generation endpoint returns 404 (@minthantkyaw28)
- **Task:** `POST /v1/images/generations` with `model: black-forest-labs/flux-schnell`, 512×512.
- **Expected:** an image URL (the cookbook and older docs show this endpoint).
- **Got:** `HTTP 404 {"detail":"Not Found"}`. `/v1/models` lists no image models, and the OpenAPI spec (`20261022`) has no images path.
- **How often:** 1/1.
- **Workaround:** none on Token Factory today. If the idea needs image generation, plan another provider.
- **Demo-worthy:** no (API availability, not model behaviour).

## 2026-10-24 12:28: zai-org/GLM-5.3-Flash: HTTP 529 "System is overloaded" on a vision call (@minthantkyaw28)
- **Task:** describe a 96×96 test PNG (red square left, blue circle right) sent as a base64 `image_url`, as one of 5 parallel calls.
- **Expected:** a one-sentence description (the other 9 vision models got it right in 0.3–2.5 s).
- **Got:** `HTTP 529 {"error":{"type":"server_error","message":"System is overloaded"}}` after 3.3 s, with no `retry-after` header.
- **How often:** 1/5 calls to this model. The next 4 retries, with 3–12 s gaps, all succeeded in 1.4–3.6 s.
- **Workaround:** treat **529 like 429**: retry with exponential backoff and keep a fallback model. On shared serverless hosting,
  capacity can dip mid-demo.
- **Demo-worthy:** yes. It's a real reliability edge of shared hosting, and the backoff plus fallback is easy to show.

## 2026-10-24 14:00: Qwen/Qwen3-235B-A22B-Instruct-2507: debrief summary contradicts its own pass/fail (@christopherwhite06)
- **Task:** examiner debrief JSON for a drive with a kerb strike and a missed signal (`apps/server/src/instructor.ts`, `/api/debrief`).
- **Expected:** a summary consistent with `result`. Both faults were driving (minor) faults, so "pass" is correct under the DVSA rule.
- **Got:** summary said "two faults that led to a fail" while `result` was "pass".
- **How often:** observed while building
- **Workaround:** the server recomputes the result from the severities with the DVSA rule and appends a correcting sentence when the model disagrees; `modelResult` is kept for the UI.
- **Demo-worthy:** yes. Logged by @christopherwhite06 in `docs/MODEL-NOTES.md`; copied here by @minthantkyaw28 so the demo-prep skill finds it.

## 2026-10-24 14:00: Qwen/Qwen3-235B-A22B-Instruct-2507: invents Highway Code rule numbers (@christopherwhite06)
- **Task:** examiner debrief with no rules supplied in the prompt.
- **Expected:** advice without rule citations, or only rules given in the input.
- **Got:** cited "Highway Code Rule 153" for kerb strikes (Rule 153 is about traffic-calming measures).
- **How often:** observed while building
- **Workaround:** the prompt forbids citing rules not quoted in the input; the server strips "(Rule N)" citations that weren't retrieved; the Highway Code RAG lookup supplies real rules.
- **Demo-worthy:** yes. Logged by @christopherwhite06 in `docs/MODEL-NOTES.md`; copied here by @minthantkyaw28 so the demo-prep skill finds it.

## 2026-10-24 14:00: Qwen/Qwen3-30B-A3B-Instruct-2507: instructor invents a direction (@christopherwhite06)
- **Task:** live instructor reply to the same [SIM] input sent twice (`/api/instructor`).
- **Expected:** directions only from the [SIM] note.
- **Got:** the second reply said "you're at the end of the road", which wasn't in the [SIM] note.
- **How often:** 1/2
- **Workaround:** temperature 0.5 → 0.3; the system prompt says "never invent directions"; the drawn sat nav stays the source of truth.
- **Demo-worthy:** yes. Logged by @christopherwhite06 in `docs/MODEL-NOTES.md`; copied here by @minthantkyaw28 so the demo-prep skill finds it.

## 2026-10-24 14:00: Qwen/Qwen3-30B-A3B-Instruct-2507: latency check, not a failure (@christopherwhite06)
- **Task:** full instructor reply, non-streaming.
- **Expected:** first token under the 1.5 s target.
- **Got:** 0.4–0.5 s for a full reply.
- **How often:** typical
- **Workaround:** none needed; replies aren't streamed.
- **Demo-worthy:** maybe (shows the fast open model is good enough live). Logged by @christopherwhite06 in `docs/MODEL-NOTES.md`; copied here by @minthantkyaw28 so the demo-prep skill finds it.


## 2026-10-24 14:11: Qwen/Qwen3-30B-A3B-Instruct-2507: Sam says "Good morning" in the afternoon (@jai-matharu)
- **Task:** Sam's first line on the Goodmayes route (`/api/instructor`), in a headless Chrome run of `?route=goodmayes`.
- **Expected:** a greeting plus the first direction.
- **Got:** "Good morning. In about a hundred yards, you'll need to turn left onto Granton Road." at 14:11 London time. The direction
  was correct (it matches the sat nav); the time of day was invented, because the status line in the prompt has no clock.
- **How often:** 1/1 run.
- **Workaround:** add the London time of day to the status line in `buildInstructorMessages`, or tell Sam not to greet by time of day.
- **Demo-worthy:** yes. Small but visible: the model fills a gap in its context with a confident guess.

## 2026-10-24 14:25: Qwen/Qwen3-Embedding-8B: "two second rule" retrieves the wrong Highway Code rule first (@jai-matharu)
- **Task:** cosine search over the 307 embedded Highway Code rules (`pnpm build:rules`, `searchRules` with no rerank model).
- **Expected:** rule 126 (stopping distances, "at least a two-second gap") first.
- **Got:** 156 (country roads, 0.556), then 126 (0.524), then 66 (0.511). Longer questions work well: "who has priority at a roundabout"
  → 185, 186, 189; "can I park on the zig-zag lines at a zebra crossing" → 191, 240, 195.
- **How often:** 1/3 test queries; short, jargon-like queries are the weak spot.
- **Workaround:** set `NEBIUS_MODEL_RERANK` so `/rerank` reorders the cosine top 20, or expand short queries before embedding.
- **Demo-worthy:** yes. It shows why the examiner may only cite rules that retrieval actually returned.
