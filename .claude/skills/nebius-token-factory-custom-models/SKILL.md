---
name: nebius-token-factory-custom-models
description: Nebius Token Factory custom-model work. Covers fine-tune jobs (SFT, LoRA or full), merging LoRA adapters, custom speculator training, dedicated endpoints, deploying custom weights, Data Lab datasets and operations, files, and batch inference. Use it when a task says fine-tune, LoRA, dedicated endpoint, deploy custom weights, Data Lab, datasets or speculator.
---

# Nebius Token Factory: custom models

**Scope:** dedicated endpoints, custom weights, post-training (SFT, LoRA, LoRA merge, custom speculator),
Data Lab, and the files / datasets / operations APIs. For chat, completions, responses, embeddings, rerank,
tools, JSON output, rate limits, caching and general billing, use the **`nebius-token-factory`** skill.

**Sources (as of 2026-10-24):** the docs at https://docs.tokenfactory.nebius.com (cited per fact) and the
[OpenAPI spec][spec] `info.version` `20261022-1d60f32ca`. **Where prose and spec disagree on a request or
response shape, this skill follows the spec** and lists the conflict below. Nothing here was run against the
live API (no key), so examples are derived from the spec, not tested. To re-check, fetch the spec, compare `info.version`, and
re-read the cited pages. Treat this file as stale after about a month.

| Load on demand | Covers |
| --- | --- |
| [`references/fine-tuning.md`](references/fine-tuning.md) | dataset formats, hyperparameters (prose vs spec), integrations, checkpoints, trainable-model snapshot, custom speculator, LoRA merge |
| [`references/dedicated-endpoints.md`](references/dedicated-endpoints.md) | templates, regions + URLs, GPU types, scaling, statuses, billing, capacity, errors, observability |
| [`references/data-lab.md`](references/data-lab.md) | Data Lab, datasets API, multipart upload, operations (`yql`, `materialize_history`, file↔dataset, `merge`, `finetuning`) |
| [`references/batch-inference.md`](references/batch-inference.md) | batch inference via `POST /v1/operations`, and the "Batch API" the prose mentions but never documents |
| [`references/api.md`](references/api.md) | endpoint table from the spec with the request fields that matter, pagination, enums, all conflicts |

## Which path fits?

| Need | Path | Watch out |
| --- | --- | --- |
| Call a stock open model, pay per token | Serverless (→ `nebius-token-factory`) | Region is "Global" and may change without notice, so it's not for production that needs a fixed region ([serverless], [legal] §5.1) |
| Reserved capacity, fixed region, no standard rate limits | **Dedicated endpoint** from a template | Billed per GPU-hour with per-minute granularity ([ov]); only models that have a template |
| Serve **your** fine-tuned weights on Nebius | Dedicated endpoint + custom weights | **Beta, on request from Support** ([custom-weights]). The spec has `custom_weights_id`, but how to obtain one is not documented |
| Serve a LoRA adapter on serverless | **Not documented.** [models]: "Deployment options currently only include via Dedicated endpoints." | To put a (MoE) LoRA on a dedicated endpoint, merge it into the base weights first ([models], [merge]) |
| Adapt a model to your data | SFT job `POST /v1/fine_tuning/jobs`, with `lora: true` or full | Some models are full fine-tuning only (DeepSeek, Gemma 4, Qwen3.5/3.6) ([models]) |
| Faster speculative decoding for a base model | Custom speculator: `method.type: "spec-draft"` | Pretokenized data only. `eagle3` output serves only on Token Factory; `eagle3_original` is portable to vLLM ([spec-draft]) |
| Training/eval data from production traffic | Data Lab import of chat completions | Logs from periods with Zero Data Retention (ZDR) on can't be imported ([dl-import]) |
| Many offline requests | Batch inference operation | See `references/batch-inference.md`; there is no `/v1/batches` in the spec |

## Base URLs and auth

- Control plane (endpoint CRUD), files, fine-tuning, datasets, operations: `https://api.tokenfactory.nebius.com`
  ([planes]; spec `servers`).
- Dedicated **inference** uses the endpoint's region ([planes]). `eu-north1` → `https://api.tokenfactory.nebius.com`,
  `eu-west1` → `https://api.tokenfactory.eu-west1.nebius.com`, `us-central1` → `https://api.tokenfactory.us-central1.nebius.com`.
  Append `/v1` for the OpenAI-compatible routes ([deploy-api]).
- Every operation needs `Authorization: Bearer <key>` (spec security `HTTPBearer`, [api-intro]). Most also
  take an optional `ai_project_id` query parameter. A 403 means the key lacks dedicated-endpoint permission ([faq]).
- In this repo: `NEBIUS_API_KEY` lives in the root `.env` and stays server-side, never in a browser-bundled variable
  (`VITE_*`, `NEXT_PUBLIC_*`). Fine-tunes and dedicated endpoints cost money, so ask the human first. Put anything left
  running, and how to stop it, in your `HANDOFF.md` lane.

## Fine-tune end to end

1. **Model:** pick one from [models] (dated snapshot in `references/fine-tuning.md`). There is no API to list SFT-trainable
   models, only `GET /v1/fine_tuning/models/spec-draft` for speculators.
2. **Data:** JSONL, one example per line ([formats]):
   - conversational: `messages`, last message from `assistant`, optional `tools`
   - instruction: `prompt` / `completion`
   - text: `text`
   - pretokenized: `input_ids`, optional `labels` (-100 = no loss) and `attention_mask`

   Size cap: **20 GB via Files API, 50 GB via Data Lab** ([formats]). Optional validation file; the docs suggest an
   80–90 / 10–20 split ([sft]).
3. **Upload:** `POST /v1/files` (multipart, `purpose=fine-tune`).
4. **Create:** `POST /v1/fine_tuning/jobs` with `model`, `training_file`, optional `validation_file`,
   `hyperparameters`, `suffix` (≤64 chars), `seed`, `integrations` (spec `FineTuningRequest`).
5. **Poll:** `GET /v1/fine_tuning/jobs/{id}`, every **≥15 s** ([sft]). Statuses (spec): `validating_files` →
   `queued` → `running` → `succeeded` | `failed` | `cancelled`. On `failed`, read `error.{code,message,param}`;
   for transient 5xx, recreate the job ([sft]).
6. **Events:** `GET …/events` (`limit`, `after`). Training is done at "Training completed successfully" ([sft]).
7. **Checkpoints:** `GET …/checkpoints` returns `step_number`, `metrics` (`train_loss`, `valid_loss`, …), and `result_files`
   (file IDs). Use the latest unless you have a reason not to ([sft]). Download each file with `GET /v1/files/{id}/content`
   (or `/link` for a URL) and save it under the `filename` from `GET /v1/files/{id}`.
8. **Deploy:** dedicated endpoint with custom weights (beta, ask Support), or push to Hugging Face with the `hf`
   integration and serve it yourself (the speculator page shows vLLM).

```ts
// Node 24, plain fetch. Shapes follow openapi.json; not run against the live API.
import { openAsBlob } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://api.tokenfactory.nebius.com";
const auth = { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}` };
async function api<T>(p: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + p, { ...init, headers: { ...auth, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}
const json = (body: unknown): RequestInit =>
  ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const form = new FormData();                                   // 3. upload
form.append("file", await openAsBlob("train.jsonl"), "train.jsonl");
form.append("purpose", "fine-tune");
const file = await api<{ id: string }>("/v1/files", { method: "POST", body: form });

type Job = { id: string; status: string; error?: { code: string; message: string } | null };
let job = await api<Job>("/v1/fine_tuning/jobs", json({        // 4. create (LoRA)
  model: "Qwen/Qwen3-8B",                                      // LoRA-capable per the models page
  training_file: file.id,
  suffix: "lplate-coach",
  hyperparameters: { lora: true, lora_r: 16, lora_alpha: 16, n_epochs: 3, context_length: 8192 },
  seed: 42,
}));
while (!["succeeded", "failed", "cancelled"].includes(job.status)) {   // 5. poll
  await new Promise((r) => setTimeout(r, 15_000));
  job = await api<Job>(`/v1/fine_tuning/jobs/${job.id}`);
}
if (job.status !== "succeeded") throw new Error(`${job.status}: ${JSON.stringify(job.error)}`);

type Ckpt = { id: string; step_number: number; result_files: string[] };
const { data } = await api<{ data: Ckpt[] }>(`/v1/fine_tuning/jobs/${job.id}/checkpoints`); // 7.
const last = data.toSorted((a, b) => b.step_number - a.step_number)[0];
for (const fid of last.result_files) {
  const { filename } = await api<{ filename: string }>(`/v1/files/${fid}`); // "<ckpt_id>/adapter_config.json"
  const res = await fetch(`${BASE}/v1/files/${fid}/content`, { headers: auth });
  await mkdir(path.dirname(path.join("out", filename)), { recursive: true });
  await writeFile(path.join("out", filename), Buffer.from(await res.arrayBuffer()));
}
```

Python: [sft] shows the same flow with the `openai` SDK (`client.files.create`, `client.fine_tuning.jobs.create /
retrieve / list_events / checkpoints.list`, `client.files.content`). **Its poll loop is inverted**: `while job.status in
ACTIVE_STATUSES`, where `ACTIVE_STATUSES = ["succeeded","failed","cancelled"]`, exits at once. Loop while the status is *not* terminal.

## Dedicated endpoint lifecycle

1. `GET /v0/dedicated_endpoints/templates` is the source of truth for valid `model_name` / `flavor_name` /
   `gpu_type` / `gpu_count` / `region` combinations ([deploy-api]). Per gpu type, the spec gives `allowed_regions`,
   `allowed_gpu_counts` and `max_replicas_allowed`.
2. `POST /v0/dedicated_endpoints` → **201 `{ endpoint: { id, routing_key, deployment, … } }`** (spec). The prose
   calls it `endpoint_id`; in the response it's `endpoint.id`.
3. The spec has **no GET-by-id**: poll `GET /v0/dedicated_endpoints` and find your `id`. First deploy takes
   "several minutes" and inference may 404 until then ([deploy-api]). **Gate traffic on readiness, not lifecycle**
   ([lifecycle]).
4. Call the regional data plane with `model: routing_key`, "exactly as returned" ([deploy-api]).
5. `PATCH /v0/dedicated_endpoints/{id}` updates only the fields you send: `name`, `description`, `routing_key`,
   `enabled`, `gpu_type`, `gpu_count`, `scaling`, `custom_weights_id`. `region` can't change ([operating]).
   The spec has no `model_name` or `flavor_name` on PATCH either.
6. `DELETE /v0/dedicated_endpoints/{id}` is permanent, and the min-replica GPUs go back to the pool ([operating]).

```ts
import OpenAI from "openai";   // constructor form from the docs' JS example; api/json helpers from the block above

const { endpoint } = await api<{ endpoint: { id: string; routing_key: string } }>(
  "/v0/dedicated_endpoints",
  json({ name: "lplate-coach", model_name: "openai/gpt-oss-20b", flavor_name: "base",   // [deploy-api] example
         gpu_type: "gpu-h100-sxm", gpu_count: 1, region: "eu-north1",
         scaling: { min_replicas: 1, max_replicas: 2 } }),
);
type Ep = { id: string; deployment: { status: string; readiness: string; ready_replicas: number } };
for (;;) {                       // poll interval not documented; add a timeout, restarts can take far longer
  const { data } = await api<{ data: Ep[] }>("/v0/dedicated_endpoints");
  if (data.find((e) => e.id === endpoint.id)?.deployment.readiness === "ready") break;
  await new Promise((r) => setTimeout(r, 30_000));
}
const client = new OpenAI({ baseURL: "https://api.tokenfactory.nebius.com/v1/", apiKey: process.env.NEBIUS_API_KEY });
const reply = await client.chat.completions.create({            // eu-north1 data plane
  model: endpoint.routing_key, messages: [{ role: "user", content: "Hello" }] });
await api(`/v0/dedicated_endpoints/${endpoint.id}`,              // stop: frees replicas, ends billing
  { ...json({ enabled: false }), method: "PATCH" });
```

| Spec `deployment.status` | Prose | `readiness` (spec) | Use |
| --- | --- | --- | --- |
| `starting` | Starting | `not_ready` → `partially_ready` | Provisioning |
| `running` | Running | `ready` / `partially_ready` / `not_ready` | Normal / degraded / outage |
| `updating` | Updating | `ready` (documented pair) | Serving; capacity can dip |
| `error` | "Warning" (heading) / "Error" (table) | any | Unresolved for >3 h → contact support ([lifecycle]) |
| `stopping` / `stopped` | Stopping / Stopped | `not_ready` | Disabled |

**Billing and capacity gotchas**
- Billed **only while ≥1 replica is running** ([billing]). Provisioning, `not_ready`, replica restarts, rolling-update
  shutdown and stop are not billed. **Ambiguity:** the same page lists `partially_ready` as "Not billed", but a
  partially ready endpoint has running replicas. GPU-hour **rates are documented in neither the prose nor the spec**.
- Scaling: the spec requires `min_replicas` ≥1, so the only way to pay nothing is `enabled: false` or delete.
- **Stopping releases the GPUs** to the shared on-demand pool. A restart (yours, an incident's, or maintenance's) requests
  capacity again and may stay `starting`/`not_ready` or `partially_ready` for a long time. Nothing holds your GPUs ([capacity], [faq]).
- Min replicas are reserved only while the endpoint is running. Replicas above min are burst capacity, not
  guaranteed. No SLA without a contract; historical success is about 99.9% ([capacity]).
- Prompt caching works but gives no cached-token discount, because billing is per GPU-hour ([cached]).
- Serverless model deprecations don't affect dedicated endpoints ([aug]). Region is a DPA commitment, with no
  cross-region failover ([legal] §5.2). Observability metrics exist **only** for dedicated endpoints ([obs]).

## Limits (as of 2026-10-24)

| Item | Limit | Source |
| --- | --- | --- |
| Dataset file size | 20 GB (Files API) · 50 GB (Data Lab) | [formats] |
| Data Lab formats | JSONL upload; Parquet **only** from S3 | [dl-datasets] |
| `context_length` | 8192–131072, default 8192 | spec `SupervisedHParameters`; [models] lists 8192/16384/32768/65536/131072 |
| `batch_size` · `n_epochs` | 1–64 (default 8) · 1–20 (default 3) | spec; prose gives "typical 8–32" |
| `lora_r` · `lora_alpha` | 8–128 (default 8) · ≥8 (default 8) | spec, [sft] |
| Job `suffix` | ≤64 chars | spec |
| Job poll interval | ≥15 s | [sft] |
| Endpoint `name` · `description` · `routing_key` | 1–100 · ≤500 · 12–128 chars, must start `dedicated/` | spec |
| Replicas | `min_replicas` ≥1, `max_replicas` ≥1, ≤ template `max_replicas_allowed` | spec |
| GPUs | max total = `gpu_count × max_replicas` | [operating] |
| Dedicated rate limits | none standard; throughput = deployed capacity | [ov] |
| Raw completions in Data Lab | deleted after 1 year unless exported to a dataset | [dl-processing] |
| Where data lives | Data Lab: processed in EU-North1 (Finland) only ([dl-processing]). Fine-tuning: datasets/artifacts stored in EU; jobs run in the EU for EU customers and the US for US customers; no region choice | [legal] §5.3 |

## Prose vs spec conflicts (the spec wins for shapes)

1. **Create endpoint response:** the prose says `endpoint_id` + `routing_key`. The spec returns 201 `{endpoint: {id, routing_key, …}}`.
2. **Lifecycle status:** the prose heading says "Warning" but its table says "Error". The spec uses lowercase `starting|running|updating|stopping|stopped|error`, and readiness `ready|partially_ready|not_ready`.
3. **Integrations:** the spec **requires `wandb.api_key`**, which the prose omits. It also accepts `wandb`, `mlflow` and `hf`; the prose says only wandb (but shows `hf`).
4. **Pretokenized field name:** the [formats] examples use `token_ids`. Its own schema text, [spec-draft] and the spec mapping use `input_ids`.
5. **8B model ID:** [sft] uses `meta-llama/Llama-3.1-8B-Instruct`, but [models] lists `meta-llama/Meta-Llama-3.1-8B-Instruct`. No API settles it.
6. **Speculator:** `num_decoding_heads` is 1–7 in the prose and 1–10 in the spec (default 3). The spec types `architecture` as a free string.
7. **`max_grad_norm`:** prose ≥0, spec >0. Spec `batch_size` max is 64.
8. **Terminal job statuses:** [sft]'s curl section lists succeeded/failed; the spec and its Python add `cancelled`.
9. **Regions:** the prose lists 3. Spec `SupportedRegion` lists 16 (full list in `references/api.md`). Data-plane
   URLs are documented for 3 only.
10. **`enabled`:** the [operating] parameter table lists it, but the spec has it on PATCH only, not on create.
11. **Spec-only fields** (no prose): `routing_key` (custom), `custom_weights_id`, `reservation_policy`
    (`AUTO|FORBID|STRICT` + `reservation_ids`), `from_checkpoint`, `tags`, `extra_body`, `method.supervised`.

## Not documented (as of 2026-10-24)

- Prices: fine-tuning (the spec calls `trained_tokens` "billable tokens"), dedicated GPU-hours, batch inference.
- Serving LoRA on serverless. Whether a checkpoint's `fine_tuned_model_checkpoint` (`ft:…:ckpt-step-N`) works as a `model`.
- How to get a `custom_weights_id`. What `from_checkpoint: {type: "ft"}` points at (it has no ID field).
- Data-plane URLs for regions other than the 3 above. Batch `completion_window` values (the spec's only example is `"12h"`).
- Several linked pages (weights conversion, deploying a custom model) were missing from the download. See `references/api.md`.

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[api-intro]: https://docs.tokenfactory.nebius.com/api-reference/introduction
[ov]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/overview
[deploy-api]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/deploy-api
[operating]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/operating
[lifecycle]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/lifecycle-and-status
[planes]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/control-data-plane
[capacity]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/capacity-and-scaling
[billing]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/billing-policy
[faq]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/faq
[custom-weights]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/custom-weights
[obs]: https://docs.tokenfactory.nebius.com/ai-models-inference/observability
[sft]: https://docs.tokenfactory.nebius.com/post-training/how-to-fine-tune
[formats]: https://docs.tokenfactory.nebius.com/post-training/datasets
[models]: https://docs.tokenfactory.nebius.com/post-training/models
[spec-draft]: https://docs.tokenfactory.nebius.com/post-training/custom-speculator
[merge]: https://docs.tokenfactory.nebius.com/post-training/merge-moe-lora-weights
[dl-datasets]: https://docs.tokenfactory.nebius.com/data-lab/datasets
[dl-import]: https://docs.tokenfactory.nebius.com/data-lab/chat-completions
[dl-processing]: https://docs.tokenfactory.nebius.com/data-lab/data-processing
[legal]: https://docs.tokenfactory.nebius.com/legal/legal-quick-guide
[cached]: https://docs.tokenfactory.nebius.com/cached-tokens
[aug]: https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice
[serverless]: https://docs.tokenfactory.nebius.com/public-serverless
