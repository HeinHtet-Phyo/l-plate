# API reference: files, fine-tuning, dedicated endpoints, datasets, operations

Taken from the OpenAPI spec [spec] (`info.version` `20261022-1d60f32ca`, downloaded 2026-10-24). The
`api-reference/{files,fine-tuning,dedicated-endpoints,datasets}/*` doc pages are one-line stubs that point at this spec.
To re-check, download the spec again, compare `info.version`, and diff the paths and schemas named here.
For inference endpoints (`/v1/chat/completions`, `/v1/embeddings`, …) see the `nebius-token-factory` skill.

## Conventions

- Server: `https://api.tokenfactory.nebius.com`. Auth: `Authorization: Bearer <key>` on **every** operation below
  (`HTTPBearer`). Dedicated *inference* goes to the regional data-plane URL instead (`dedicated-endpoints.md`).
- `ai_project_id` (query; in the body for datasets/operations) scopes a call to a project. Optional everywhere.
- Validation errors → **422** `HTTPValidationError`. Other documented statuses: dedicated `POST` → **201**; FAQ codes 401/403/404/409.
- Pagination differs by group: files `limit` only (default 10); fine-tuning jobs/events/checkpoints `limit` + `after`;
  datasets `limit` (1–1000) + `after` + `sort_by`/`sort_order`; dataset content `limit` + `offset`; operations
  `limit` (1–100) + `cursor_time` (ISO 8601).
- Object IDs are opaque strings. Dedicated `endpoint_id` is a **uuid**.

## Files

| Method · path | Request | Response |
| --- | --- | --- |
| `POST /v1/files` | multipart: `file` (bytes), `purpose` = `fine-tune` \| `batch` \| `history` | `OpenAIFile {id, bytes, created_at, filename, object, purpose, status?, status_details?}` |
| `GET /v1/files` | `limit` (10), `purpose` | `{data: OpenAIFile[], object}` |
| `GET /v1/files/{file_id}` | | `OpenAIFile` (`filename` carries the checkpoint path) |
| `GET /v1/files/{file_id}/content` | | raw content (untyped) |
| `GET /v1/files/{file_id}/link` | | `{url}`, a download link (expiry not documented) |
| `DELETE /v1/files/{file_id}` | | `{id, deleted, object}` |

The Files API takes datasets of up to 20 GB ([formats]). What `purpose: "history"` is for is not documented.

## Fine-tuning

| Method · path | Request | Response |
| --- | --- | --- |
| `POST /v1/fine_tuning/jobs` | `FineTuningRequest`: **`model`, `training_file`** + `validation_file`, `hyperparameters`, `method`, `integrations`, `from_checkpoint`, `seed`, `suffix` (≤64), `tags`, `extra_body`; extra fields allowed | `FineTuningJob` |
| `GET /v1/fine_tuning/jobs` | `limit`, `after` | `{object, data: FineTuningJob[], has_more}` |
| `GET /v1/fine_tuning/jobs/{job_id}` | | `FineTuningJob` |
| `POST /v1/fine_tuning/jobs/{job_id}/cancel` | | `FineTuningJob` |
| `GET /v1/fine_tuning/jobs/{job_id}/events` | `limit`, `after` | `{data: [{id, created_at, level, message, type, data}], has_more}` |
| `GET /v1/fine_tuning/jobs/{job_id}/checkpoints` | `limit`, `after` | `{data: [{id, step_number, fine_tuned_model_checkpoint, metrics, result_files}], first_id, last_id, has_more}` |
| `GET /v1/fine_tuning/jobs/{job_id}/checkpoints/{checkpoint_id}` | | checkpoint **without** `result_files` |
| `GET /v1/fine_tuning/models/spec-draft` (also `/fine_tuning/models/spec-draft`) | | `{models: [{hf_repo_name, huggingface_url, size_b, context_window_k, quantization, description, license, price {sku_id, value}}]}` |

Enums: job `status` = `validating_files|queued|running|succeeded|failed|cancelled`. Event `level` = `info|warn|error`,
`type` = `message|metrics`. `method.type` = `supervised|spec-draft`. Speculator `loss.type` = `kl|lk_alpha|lk_hybrid`.
Integration `type` = `wandb|mlflow|hf`. Field ranges: `fine-tuning.md`.

## Dedicated endpoints (control plane, `v0`)

| Method · path | Request | Response |
| --- | --- | --- |
| `GET /v0/dedicated_endpoints/templates` | `ai_project_id` | `{data: [{name, type, metadata, flavors: {<flavor>: {quantization, use_cases, tags, base_model_slug, available_configurations: {gpu_configurations: {<gpu>: {allowed_regions, allowed_gpu_counts, max_replicas_allowed}}}}}}]}` |
| `POST /v0/dedicated_endpoints` | **`name`, `model_name`, `flavor_name`, `gpu_type`, `region`, `gpu_count`, `scaling{min_replicas,max_replicas}`** + `description`, `routing_key`, `custom_weights_id`, `reservation_policy` | **201** `{endpoint: DedicatedEndpoint}` |
| `GET /v0/dedicated_endpoints` | `ai_project_id` | `{data: DedicatedEndpoint[], object}` |
| `PATCH /v0/dedicated_endpoints/{endpoint_id}` | any of `name`, `description`, `routing_key`, `enabled`, `gpu_type`, `gpu_count`, `scaling`, `custom_weights_id` | `DedicatedEndpoint` |
| `DELETE /v0/dedicated_endpoints/{endpoint_id}` | | `{}` |

`DedicatedEndpoint` = `{id, name, description, enabled, routing_key, model_name, flavor_name, region, gpu_type, gpu_count,
custom_weights_id, scaling, reservation_policy, deployment {ready_replicas, status, readiness}, created_at}`.
There's no GET for a single endpoint. Constraints: `name` 1–100, `description` ≤500, `routing_key` 12–128 and must start
`dedicated/`, `gpu_count` ≥0, replicas ≥1.

Enums:
- `deployment.status` = `starting|running|updating|stopping|stopped|error`
- `deployment.readiness` = `ready|partially_ready|not_ready`
- `reservation_policy.policy` = `AUTO|FORBID|STRICT`
- `SupportedGPU` = `gpu-l40s-d`, `gpu-l40s-a`, `gpu-h100-sxm`, `gpu-h200-sxm`, `gpu-b200-sxm`, `gpu-b200-sxm-a`, `gpu-b300-sxm`
- `SupportedRegion` = `eu-north1`, `man-ik8s`, `us-central1`, `us-north1`, `eu-west1`, `eu-west2`, `eu-south1`,
  `me-west1`, `uk-south1`, `tf-eu1`, `tf-uk1`, `tf-us1`, `tf-us2`, `tf-us3`, `tf-us4`, `tf-ca1`. The prose documents
  only `eu-north1`, `eu-west1` and `us-central1`, the only regions with known inference URLs.

## Datasets and uploads

| Method · path | Request | Response |
| --- | --- | --- |
| `POST /v1/datasets` | inline `{name, folder, schema, rows}` **or** S3 `{name, folder, s3_service_url, s3_region, s3_uri, s3_key_id, s3_secret_key}` | `CreateDatasetResponse` |
| `GET /v1/datasets` | `limit`, `after`, `sort_by`, `sort_order` | `{data, first_id, last_id, has_more}` |
| `GET` / `PATCH` / `DELETE /v1/datasets/{dataset_id}` | PATCH `{name?, folder?}` | `DatasetResponse` / `{}` |
| `GET /v1/datasets/{dataset_id}/content` | `limit` (1–1000), `offset` | rows |
| `GET /v1/datasets/{dataset_id}/export` | `format` csv\|jsonl (req), `columns`, `limit` | file body |
| `GET /v1/datasets/{dataset_id}/query_templates` | | `{yql}` |
| `POST /v1/datasets/uploads` | `{name, schema, folder}` | `{id, upload_info}` |
| `POST /v1/datasets/uploads/{upload_id}/parts` | raw bytes (`application/octet-stream`) | `{upload_part_info {id, upload_id, status, created_at}}` |
| `GET /v1/datasets/uploads/{upload_id}/parts` | | `{data: parts[]}` |
| `POST /v1/datasets/uploads/{upload_id}/complete` | `{part_ids}` | `{id, upload_info}` |
| `GET /v1/datasets/uploads/{upload_id}` · `POST …/cancel` | | `{id, upload_info}` |

Enums: dataset `status` = `READY|PENDING|FAILED|TEMPORARY|DRAFT`. Origin = `upload|s3|demo`. Upload status =
`PENDING|COMPLETING|COMPLETED|FAILED|CANCELLED`. Column types = `string|integer|boolean|float|double|json|null`, plus `option`.

## Operations

| Method · path | Request | Response |
| --- | --- | --- |
| `POST /v1/operations` | `type` = `yql`, `materialize_history`, `batch_inference`, `finetuning`, `file_to_dataset`, `dataset_to_file` or `merge`, + `params`, `src`, `dst` (see `data-lab.md`, `batch-inference.md`) | `{id, type, params, src, dst, status, created_at, in_progress_at, finished_at}` |
| `GET /v1/operations` | `limit` (1–100), `cursor_time`, `type` | `{data}` |
| `GET /v1/operations/{operation_id}` | | operation |
| `POST /v1/operations/{operation_id}/cancel` | | `{}` |
| `GET /v1/operations/{operation_id}/results` | `limit`, `after` | `finetuning` → checkpoint list; `dataset_to_file` → `{file_id}`. Nothing else |
| `GET /v1/operations/{operation_id}/errors` | | `{data: string[]}` |

Operation `status` = `queued|running|succeeded|failed|cancelled|unknown`. The spec's operation ID for `/results` is
misnamed `list_fine_tuning_checkpoints_v1_operations…`, which matters for generated clients.

## All prose ↔ spec conflicts and doc errors found (2026-10-24)

| # | Prose says | Spec / reality | Where |
| --- | --- | --- | --- |
| 1 | Create returns `endpoint_id`, `routing_key` | 201 `{endpoint: {id, routing_key, …}}` | [deploy-api] |
| 2 | Lifecycle "Warning" (heading) and "Error" (table) | `error`, all lowercase; readiness `partially_ready`/`not_ready` | [lifecycle] |
| 3 | `enabled` is an endpoint parameter | Not on create; PATCH only | [operating] |
| 4 | Only regions `eu-north1`, `eu-west1`, `us-central1` | 16-value enum; templates decide | [operating] |
| 5 | Region is the only immutable field | PATCH also has no `model_name` or `flavor_name` | [operating] |
| 6 | W&B needs `project` (+ optional name/entity/tags) | `api_key` is **required** | [sft] |
| 7 | "Currently supported: wandb" | `wandb`, `mlflow`, `hf` | [sft] |
| 8 | Job object echoes `hf.api_token` | Response schemas omit secrets | [sft] |
| 9 | `max_grad_norm` ≥0; `batch_size` no max | >0; 1–64 | [sft] |
| 10 | `context_length` one of 5 values | Integer 8192–131072 | [models] |
| 11 | Terminal statuses succeeded/failed (curl part) | + `cancelled` | [sft] |
| 12 | Python poll loop `while job.status in ACTIVE_STATUSES`, where that list holds the terminal statuses | Inverted; exits at once | [sft] |
| 13 | Pretokenized examples use `token_ids` | `input_ids` (same page's schema text, [spec-draft], spec mapping) | [formats] |
| 14 | 8B ID `meta-llama/Llama-3.1-8B-Instruct` | [models] lists `meta-llama/Meta-Llama-3.1-8B-Instruct`; spec examples match [sft]. Unresolved | [sft], [models] |
| 15 | `num_decoding_heads` 1–7 | 1–10 | [spec-draft] |
| 16 | `architecture`: `eagle3_original` or `eagle3` | Free string, default `eagle3_original` | [spec-draft] |
| 17 | Speculator hyperparameters list | Spec adds `weight_decay`, `packing`; `learning_rate` exclusive (0, 1) | [spec-draft] |
| 18 | Merge script usage `merge_weights.py -i -l -o` (docstring) | Page saves it as `merge_lora.py`; flags are equivalent | [merge] |
| 19 | `partially ready` is not billed | Same page: billed whenever ≥1 replica is running | [billing] |
| 20 | "Batch API" with higher limits; Batch API permission | No batch endpoint in the spec; only the `batch_inference` operation | [rate], [groups] |
| 21 | Control plane handles "Uploading models / weights" | No upload endpoint; only `custom_weights_id` | [planes] |

Spec-only features (no prose): custom `routing_key`, `custom_weights_id`, `reservation_policy`, `from_checkpoint`, `tags`,
`extra_body`, `method.supervised`, MLflow integration, `/v1/files/{id}/link`, the whole datasets/uploads/operations API
(the prose only describes the Data Lab UI).

## Linked pages missing from the 2026-10-24 download

`post-training/weights-conversion` (GPT-OSS MXFP4, linked from [models]), `post-training/deploy-custom-model` and
`fine-tuning/deploy-custom-model` (linked from [sft] as the deploy step), `fine-tuning/overview`, `fine-tuning/models`.
They may be dead links or simply weren't downloaded; check them live before relying on them.

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[deploy-api]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/deploy-api
[operating]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/operating
[lifecycle]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/lifecycle-and-status
[planes]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/control-data-plane
[billing]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/billing-policy
[sft]: https://docs.tokenfactory.nebius.com/post-training/how-to-fine-tune
[formats]: https://docs.tokenfactory.nebius.com/post-training/datasets
[models]: https://docs.tokenfactory.nebius.com/post-training/models
[spec-draft]: https://docs.tokenfactory.nebius.com/post-training/custom-speculator
[merge]: https://docs.tokenfactory.nebius.com/post-training/merge-moe-lora-weights
[rate]: https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits
[groups]: https://docs.tokenfactory.nebius.com/team-access/groups
