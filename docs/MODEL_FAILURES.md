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

