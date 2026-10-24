---
name: nebius-token-factory
description: Call Nebius Token Factory (formerly Nebius AI Studio), the OpenAI-compatible API for open models. Covers chat completions, the Responses API, completions, embeddings, rerank, vision, tool calling, JSON output, model IDs and deprecations, rate limits, service tiers, prompt caching, data retention and ZDR. Use for any code that calls api.tokenfactory.nebius.com or reads NEBIUS_API_KEY.
---

# Nebius Token Factory: inference

Repo skill, written from the official docs on 2026-10-24: https://docs.tokenfactory.nebius.com (page
index: [`llms.txt`](https://docs.tokenfactory.nebius.com/llms.txt)) and the live OpenAPI spec
([`openapi.json`](https://api.tokenfactory.nebius.com/openapi.json), version `20261022`). Nothing here was tried
against a real key when it was written. When a live call confirms or contradicts something, fix it here. Re-check if this is over a month old.

| Need | Go to |
| --- | --- |
| **Hackathon quick start**: setup check, model shortlist, structured output, comparison harness, judging lens | `token-factory` (read it first in this repo) |
| Fine-tuning, LoRA, dedicated endpoints, custom weights, Data Lab, **batch inference** | `nebius-token-factory-custom-models` |
| Sandboxes (isolated containers that run agent code) | `nebius-sandboxes` |
| Nebius **AI Cloud** (VMs, GPUs, Kubernetes, Serverless AI jobs/endpoints, `nebius` CLI) | the upstream AI Cloud skills in `.agents/skills/nebius-*`; see `nebius-corrections` first |
| Every endpoint's fields, response headers, error codes | [`references/api-reference.md`](references/api-reference.md) |

Token Factory and Nebius AI Cloud are **separate products**, with separate consoles, docs and auth. Token
Factory uses a project API key. AI Cloud uses IAM tokens and service accounts through the `nebius` CLI. Don't mix them.

## Quick facts

| Item | Value |
| --- | --- |
| Base URL | `https://api.tokenfactory.nebius.com/v1/` ([quickstart](https://docs.tokenfactory.nebius.com/quickstart)). Regional hosts `api.tokenfactory.eu-west1.nebius.com` / `api.tokenfactory.us-central1.nebius.com` are for **dedicated endpoints** only ([control & data plane](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/control-data-plane)) |
| Auth | `Authorization: Bearer <key>`. Keys are created per **project** at https://tokenfactory.nebius.com/project/api-keys and shown once ([API intro](https://docs.tokenfactory.nebius.com/api-reference/introduction)) |
| Env var (docs convention) | `NEBIUS_API_KEY` |
| SDK | Any OpenAI SDK with `baseURL` changed ([switch](https://docs.tokenfactory.nebius.com/switch)). There's no Nebius inference SDK |
| Endpoints | `POST /v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/rerank` · `GET /v1/models`. Each takes an optional `?ai_project_id=` query parameter |
| Not in the OpenAPI spec | `/v1/images/generations` (only on the [image example page](https://docs.tokenfactory.nebius.com/api-reference/examples/image-generation)) and any OpenAI-style `/v1/batches`. Batch runs through Data Lab operations (see the custom-models skill) |
| Hierarchy | Organization → Projects → API keys, fine-tuning jobs, dedicated endpoints, files, datasets ([org & projects](https://docs.tokenfactory.nebius.com/team-access/org-projects)) |
| Billing | Bank card required at sign-up. **$1 trial credit for 30 days**. A card charge that fails **suspends the account** ([billing](https://docs.tokenfactory.nebius.com/other-capabilities/billing-new)). HTTP **402** = payment required |
| Status page | https://status.nebius.com |
| Examples | https://github.com/nebius/token-factory-cookbook |

## Minimal call (TypeScript, Node 24, server side)

Plain `fetch` avoids a new dependency:

```ts
const NEBIUS_URL = 'https://api.tokenfactory.nebius.com/v1'

export async function chat(model: string, messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const res = await fetch(`${NEBIUS_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 512 }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Token Factory ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body.choices[0].message.content as string
}
```

With the `openai` npm package: `new OpenAI({ baseURL: 'https://api.tokenfactory.nebius.com/v1/', apiKey: process.env.NEBIUS_API_KEY })`,
then the usual `client.chat.completions.create(...)`, `client.responses.create(...)` or `client.embeddings.create(...)`.

## Picking a model

- **Get IDs from the API, not from the docs.** `GET /v1/models?verbose=true` returns `RichModel` objects with
  `context_length`, `architecture.modality` (e.g. `text->text`), `quantization`, `pricing` (USD **per token**, as
  strings), `per_request_limits` (`tokens_per_minute`, `requests_per_minute`), `regions`, `supported_features`,
  `supported_sampling_parameters` and `status` (`validating` / `active` / `error` / `deleted`)
  ([list of models](https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models)).
- **Many doc examples use retired models.** The [switch page](https://docs.tokenfactory.nebius.com/switch) uses
  `moonshotai/Kimi-K2.5`, which was removed on 2026-06-22. Other examples use Llama 3.1, `Qwen/Qwen2-VL-72B-Instruct`
  and `stability-ai/sdxl`. Copy the shape of those calls, never their model IDs.
- **Flavors:** append `-fast` for the low-latency flavor. Output is identical to base, but price and latency
  differ ([overview](https://docs.tokenfactory.nebius.com/ai-models-inference/overview)). Check `/v1/models` to see which
  flavors a model actually has; deprecation notices list `-fast` IDs separately.
- **Deprecations remove serverless models on a fixed date, with no automatic rerouting.** Dedicated endpoints are
  unaffected. The [June 2026 notice](https://docs.tokenfactory.nebius.com/june-2026-deprecation-notice) removed
  11 models, including DeepSeek-V3.2, Kimi-K2.5, GLM-5 and `gpt-oss-120b-fast`.
  The [August 2026 notice](https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice) removed 10 on
  2026-08-31, including `meta-llama/Llama-3.3-70B-Instruct`, `Qwen/Qwen3-32B`, `Qwen/Qwen2.5-VL-72B-Instruct` and
  `MiniMaxAI/MiniMax-M2.5`.
- **Snapshot (2026-10-24, checked live against `/v1/models`: 29 models).** These are the replacements the August notice recommends:
  `nvidia/Nemotron-3_5-Lightning`, `MiniMaxAI/MiniMax-M3` (also the suggested vision replacement),
  `deepseek-ai/DeepSeek-V4-Flash-0731`, `nvidia/nemotron-3-super-120b-a12b` and `Qwen/Qwen3.5-397B-A17B`.
  Live result: all of them are served **except `Qwen/Qwen3.5-397B-A17B`**. `MiniMax-M3` is listed as text→text, so for vision use
  `MiniMaxAI/MiniMax-M3.1-Flash`, `moonshotai/Kimi-K3`, `zai-org/GLM-5.3-Flash` or `Qwen/Qwen3.8-27B`. `openai/gpt-oss-120b` is served.
  The embeddings example `BAAI/bge-en-icl` is **not served**; use `Qwen/Qwen3-Embedding-8B` (4096 dims).
- Keep the model ID in config, not in code, so a deprecation is a one-line change.

## Chat completions: what's supported

The full field list is in `references/api-reference.md`. Highlights from the spec:

- Standard OpenAI fields, including `max_completion_tokens`, `n`, `stop` (≤4), `logprobs`/`top_logprobs`, `logit_bias`,
  `stream` + `stream_options`, `tools`/`tool_choice`, `response_format`, `user` and `store`. The API "supports the full
  set of vLLM parameters" ([overview](https://docs.tokenfactory.nebius.com/ai-models-inference/overview)). The examples
  use `top_k` and `guided_json`. Check `supported_sampling_parameters` on the model.
- `reasoning_effort`: `none` | `minimal` | `low` | `medium` | `high` | `xhigh` | `max`. Whether a model honours it is
  model-specific. Reasoning text may come back in `reasoning_content`, and request messages accept
  `reasoning_content`/`reasoning`.
- **Vision:** content parts `{type: "image_url", image_url: {url, detail}}` with an https URL or base64 data URL.
  The spec also has `{type: "video_url", video_url: {url}}` for models that take video
  ([vision example](https://docs.tokenfactory.nebius.com/api-reference/examples/vision-capabilities)).
- **Streaming usage:** set `stream_options: { include_usage: true }`. Otherwise some models send no usage, and so no
  `cached_tokens`, in the stream ([cached tokens](https://docs.tokenfactory.nebius.com/cached-tokens)).
- `extra_body` is a real request field in the spec. In the Python SDK it merges extra params. In JS, add vLLM extras
  as top-level fields. The docs' JS examples nest a literal `extra_body` object, which only works because the server
  declares it.

### Tool calling

OpenAI format. The model **only proposes** calls; you run them and send back `{role: "tool", tool_call_id, content}`
([function calling](https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling)). `tool_choice` is
`"auto"` (default), `"none"`, `"required"` or `{type: "function", function: {name}}`. Tool support varies by
model, so check `supported_features`.

### Structured output

Use this shape. It's the OpenAI one, and it matches the spec's `JsonSchemaResponseFormat`:

```ts
response_format: {
  type: 'json_schema',
  json_schema: { name: 'verdict', strict: true, schema: { type: 'object', properties: { pass: { type: 'boolean' } }, required: ['pass'], additionalProperties: false } },
}
```

`{type: "json_object"}` forces valid JSON with no schema. **Doc errors on the
[JSON page](https://docs.tokenfactory.nebius.com/ai-models-inference/json)**:
- The Python `json_schema` example is a syntax error (missing commas) and passes the bare schema without `name`/`schema`.
- The cURL example sends `"response format"` with a space, so the field would be silently ignored.

The page itself recommends also putting the schema in the prompt and testing several models. Look for the
"JSON mode" tag on a model card. Always handle `message.refusal` and `JSON.parse` failures.

## Responses API

`POST /v1/responses` follows OpenAI's `CreateResponse`. It supports `input`, `instructions`, `max_output_tokens`,
`reasoning.effort`, `text.format` (json_schema/json_object), function `tools`, `stream`, `previous_response_id`,
`store`, `background`, `truncation` and `prompt_cache_key` ([OpenAPI](https://api.tokenfactory.nebius.com/openapi.json)).
The spec copies OpenAI's whole tool union (web search, code interpreter, file search, computer use, MCP and more).
**No prose page says Token Factory runs any built-in tool**, so assume only function tools work until a test proves
otherwise. Nor does any page say how long `store`d responses are kept, which matters for ZDR. Usage comes as
`input_tokens`, `output_tokens` and `input_tokens_details.cached_tokens`.

## Embeddings, rerank, images

- `POST /v1/embeddings`: `model`, `input` (string, string[] or tokens), `encoding_format` (`float` | `base64`) and
  `dimensions`.
- `POST /v1/rerank`: `model`, `query` and `documents` (string[]). It returns `results[{index, document, relevance_score}]`,
  in vLLM's rerank format.
- Images: the [example page](https://docs.tokenfactory.nebius.com/api-reference/examples/image-generation) shows
  `POST /v1/images/generations` with `response_format: "b64_json" | "url"` and extras `width`, `height`,
  `num_inference_steps`, `seed`, `negative_prompt` and `response_extension`. Returned URLs are **temporary**, so
  save the image. The endpoint is missing from the OpenAPI spec and the example models may be retired, so confirm
  with `/v1/models?verbose=true` (modality) before building on it.

## Rate limits, tiers, errors

- Limits are **dynamic, per model**, in RPM and TPM ([rate limits](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)).
  They're checked in 15-minute windows. Average use of 80% or more raises the next window's limit ×1.2; 50% or less
  lowers it ÷1.5; the ceiling is 20× base. Your base limits are shown at https://tokenfactory.nebius.com/project/rate-limits.
  "Enterprise" removes the soft caps.
- Response headers include `x-ratelimit-{limit,remaining,reset}-{requests,tokens}` and `x-ratelimit-dynamic-*`.
  `x-ratelimit-over-limit: yes` means the request was served from spare capacity, as an early warning. `Retry-After`
  comes on a 429.
- `service_tier` takes `auto` (default: normal, or over-limit when there's spare capacity), `default` (return a 429
  rather than run over the limit) or `flex` ("does not consume rate-limit credits", runs at lower priority, can
  still 429). The enum also has `no-limit`, which the spec doesn't describe. Flex pricing isn't documented.
- Errors: 400, 401, **402 (payment required)**, 403, 404, 422 (validation), **429**, 500, **503 (unavailable)**,
  **529 (overloaded)**. Retry 429/503/529 with backoff and honour `Retry-After`. Don't retry 4xx validation errors.

## Prompt caching (automatic)

- It's implicit, best-effort, and you can't configure it: no cache keys, no TTL ([cached tokens](https://docs.tokenfactory.nebius.com/cached-tokens)).
- `usage.prompt_tokens_details.cached_tokens` (chat/completions) or `usage.input_tokens_details.cached_tokens`
  (Responses) reports the cached tokens. Serverless bills them at the cheaper "cached input" price.
- Put stable content first (system prompt, tool definitions, examples), append history, keep the same model, and send
  related requests close together. `cached_tokens: 0` on a repeat is valid, not an error.
- On serverless the **cache is shared across all customers of a model**. It doesn't expose text, but never treat
  it as an isolation boundary, and keep secrets out of shared prefixes. Dedicated endpoints get a per-customer cache.
- No cached pricing for embeddings, rerank, images or batch.

## Data, privacy, region (read before sending user data)

From the [legal quick guide](https://docs.tokenfactory.nebius.com/legal/legal-quick-guide):
- **By default, prompts and outputs are stored** (in Finland, EU) and used for speculative decoding, never for training.
  **Zero Data Retention** is an organization-level switch in the account profile. It stops storage and speculative
  decoding, and only org Admins can change it ([groups](https://docs.tokenfactory.nebius.com/team-access/groups)).
- Public (serverless) endpoints are region **"Global"**. Processing can move without notice, and a region-specific
  `base_url` can stop working. For a contractual region, use a dedicated endpoint
  ([public serverless](https://docs.tokenfactory.nebius.com/public-serverless)).
- Fine-tuning data is always stored in the EU.
- Requests through OpenRouter are plain serverless traffic.

## Using it in Nebius-Hack

- **Start with the `token-factory` skill** for the hackathon brief, the key check, the model shortlist and the
  model-comparison harness. This skill is the deeper API reference behind it.
- **Keys.** `NEBIUS_API_KEY` lives in the root `.env` (gitignored), and `.env.example` holds the placeholder. Call the API only
  from server-side code or scripts. Never put the key in a browser-bundled variable (`VITE_*`, `NEXT_PUBLIC_*`),
  front-end code, logs, commits or chat.
- **Model IDs** go in one config constant. The model lists in this skill and in `token-factory` are unverified snapshots;
  `GET /v1/models` wins. When an ID turns out to be wrong or retired, fix both skills and log it in
  `docs/MODEL_FAILURES.md`.
- **Data:** Token Factory keeps prompts and outputs by default (see above). Use synthetic or public data for the demo.
  If real personal data is involved, turn on ZDR (org Admins only) or log a decision with `/decision` first.
- **Failures are demo material.** Log bad JSON, wrong tool calls, 429s and slow responses in `docs/MODEL_FAILURES.md`
  (`/log-failure`).
- The Token Factory spec has **no audio or realtime endpoint**. If the idea needs live voice, plan another provider for
  that part.
