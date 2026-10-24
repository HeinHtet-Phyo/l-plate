# Data Lab, datasets and operations reference

As of 2026-10-24. Sources: the 5 `data-lab/*` pages, [presets], [legal], and the OpenAPI spec [spec]
(`20261022-1d60f32ca`), paths `/v1/datasets*` and `/v1/operations*`, schemas `Create*OperationRequest`, `DatasetResponse`,
`UploadResponse`, `OperationResponse`. The API-reference pages for these endpoints are stubs that point at the spec,
so **the spec is the only API source**. Nothing here was run live. Batch inference has its own file: `batch-inference.md`.

## What Data Lab is ([dl])

A workspace (https://tokenfactory.nebius.com/datalab) for:
- **inference logs**: chat completions from the API and Playground, collected automatically unless ZDR is on
- **filtered datasets**: built from logs with SQL
- **uploaded datasets**
- **batch inference outputs**
- **fine-tuning outputs**: checkpoints and the fine-tuned model

A dataset is a table of rows with a defined schema. It can come from an upload, an S3 connection, imported logs, or a
transformation of another dataset ([dl-datasets]).

| Format | Direct upload | S3 connection |
| --- | --- | --- |
| JSONL (each line a JSON object) | ✔ | ✔ |
| Parquet | ✘ | ✔ |

- S3: "works with the dataset and its metadata without creating an additional raw-data copy" of the S3 object ([dl-datasets]).
- Large uploads use multipart; the UI is "better to use API" for large files ([dl-datasets]). Size cap: 50 GB via Data Lab ([formats]).

## Importing chat completions ([dl-import], [dl-datasets])

UI: **Import completions** → time range, model, name → **Start import**. The result appears as a dataset. API equivalent:
the `materialize_history` operation (below).
- Imported columns may include `id`, `choice_id`, `prompt`, `completion`, `dialogue`, `started`, `completed`,
  `raw_prompt`, `raw_completion`, `completion_tokens`, `prompt_tokens`, `ai_project_id`, `model_flavor_id`,
  `tenant_user_account_id`, `error_string`.
- **ZDR:** with Zero Data Retention on, no logs are stored. Only the parts of a range where ZDR was off get imported, and a
  fully-ZDR range imports nothing. ZDR is an org-level setting ([legal] §4.1).
- Uses: reviewing production prompts, debugging, eval sets from real usage, and training data without manual logging.

## Retention and location ([dl-processing], [dl-ft], [legal])

| Data | Retention |
| --- | --- |
| Raw completions not exported to a dataset | **Deleted after 1 year.** Export them to a dataset to keep them |
| Uploaded datasets · datasets from exported completions · datasets from completed batch jobs | Kept until you delete them |

- All Data Lab processing (logs, datasets, batch outputs, training data) happens **only in EU-North1 (Finland)**. Datasets are
  stored centrally there. Fine-tuning jobs themselves run in EU or US data centres.
- Nebius acts as data processor under the DPA. You'll be told in advance if hosting locations change.

## Datasets API (spec)

| Call | Body / params | Returns |
| --- | --- | --- |
| `POST /v1/datasets`, inline | `{name, folder, schema[], rows[], ai_project_id?}`, all except the project ID required | `CreateDatasetResponse` |
| `POST /v1/datasets`, from S3 | `{name, folder, s3_service_url, s3_region, s3_uri, s3_key_id, s3_secret_key, ai_project_id?}` | same |
| `GET /v1/datasets` | `limit` 1–1000 (100), `after`, `sort_by` created_at\|name, `sort_order` asc\|desc, `ai_project_id` | `{data[], first_id, last_id, has_more}` |
| `GET /v1/datasets/{id}` | | `DatasetResponse` |
| `PATCH /v1/datasets/{id}` | `{name?, folder?}` | `DatasetResponse` |
| `DELETE /v1/datasets/{id}` | | `{}` |
| `GET /v1/datasets/{id}/content` | `limit` 1–1000 (100), `offset` | rows (untyped in spec) |
| `GET /v1/datasets/{id}/export` | `format` **csv\|jsonl** (req), `columns` (comma list), `limit` | file body (untyped) |
| `GET /v1/datasets/{id}/query_templates` | | `{yql}`, e.g. `SELECT * FROM {src_1}` |

- **Schema** (`ColumnSchema`): `{name, type}`, where `type` is `{name: string|integer|boolean|float|double|json|null}` or
  `{name: "option", item: <type>}` (nullable). Spec example: `[{name:"text",type:{name:"string"}},{name:"text_1",type:{name:"option",item:{name:"string"}}}]`.
- **DatasetResponse:** `id`, `name`, `status` (`READY|PENDING|FAILED|TEMPORARY|DRAFT`), `schema`, `metadata`, `folder`,
  `current_version_summary {id, origin {type: upload|s3|demo}, row_count, size_bytes}`, `created_at`, `error`,
  `ai_project_id`. `current_version` and `current_version_origin` are **deprecated**: take the version from
  `current_version_summary.id`.
- `name` is described as "ID of the dataset", but the object's `id` is a separate hex string. Use `id` in later calls.
- **S3 credentials go in the request body** (`s3_key_id`, `s3_secret_key`). Keep them server-side.
- The prose calls datasets "versioned" ([dl-ft]). The spec exposes versions only as IDs. Listing old versions is not documented.

### Multipart upload (large files)

1. `POST /v1/datasets/uploads` with `{name, schema[], folder}` → `{id, upload_info {status, dataset, …}}`.
2. `POST /v1/datasets/uploads/{upload_id}/parts` with the raw bytes (`application/octet-stream`) → `{upload_part_info {id, status}}`.
3. `POST /v1/datasets/uploads/{upload_id}/complete` with `{part_ids: [...]}` → `upload_info.dataset.id` once complete.
- Also: `GET …/uploads/{id}` (status `PENDING|COMPLETING|COMPLETED|FAILED|CANCELLED`), `GET …/parts`, `POST …/cancel`.
- **Not documented:** part size limits, part ordering rules, and what byte format a part holds (the UI accepts JSONL).

## Operations API (spec)

All Data Lab jobs are operations. `POST /v1/operations` with a body chosen by `type`:

| `type` | `params` | `src` / `dst` | What it does |
| --- | --- | --- | --- |
| `yql` | `{query}` e.g. `SELECT * FROM {src_0} WHERE …` | `src[{id, version}]`, optional `dst` (temporary dataset if omitted) | SQL-style filter or transform ("prepare datasets via SQL", [dl]) |
| `materialize_history` | `{start_datetime, end_datetime, dataset_name, model_name?}` (ISO 8601) | – | Import chat-completion logs into a dataset |
| `batch_inference` | `{model, completion_window}` | `src[{id, version, mapping}]`, optional `dst` | See `batch-inference.md` |
| `finetuning` | `{model_name, method, hyperparameters? (legacy), from_checkpoint?, integrations?, seed?, suffix?, tags?}` | `src[{type: "train"\|"validation", id, version, mapping}]` | Fine-tune straight from datasets, no file export needed |
| `file_to_dataset` | `{file_id, dataset_name?}` | – | Files API file → dataset |
| `dataset_to_file` | `{purpose: "fine_tuning"\|"inference", model?}` | `src[{dataset {id, version}, mapping}]` | Dataset → file. `model` is "Model id for inference batch export" |
| `merge` | `{dataset_name?}` (generated if omitted) | `src[{id, version}]` | Merge datasets |

All accept `ai_project_id`. **Fine-tuning `mapping`** (also for `dataset_to_file`) is one of:
- `{type:"messages", messages:{type:"column", name}}`
- `{type:"prompts", prompt:{…}, completion:{…}}`
- `{type:"text", text:{…}}`
- `{type:"pretokenized", input_ids:{…}, labels?, attention_mask?}`

`dataset_to_file` also takes `{type:"text_messages", messages, max_tokens?, custom_id?}`.

Spec example for `finetuning`:
```json
{ "type": "finetuning",
  "params": { "model_name": "meta-llama/Llama-3.1-8B",
              "method": { "type": "supervised", "supervised": { "hyperparameters": { "lora": false, "n_epochs": 3 } } } },
  "src": [ { "type": "train", "id": "<dataset id>", "version": "<version>",
             "mapping": { "type": "text", "text": { "type": "column", "name": "text" } } } ] }
```

| Call | Notes |
| --- | --- |
| `GET /v1/operations` | `limit` 1–100 (100), `cursor_time` (ISO 8601 cursor), `type`, `ai_project_id` → `{data[]}` |
| `GET /v1/operations/{id}` | `{id, type, params, src, dst, status, created_at, in_progress_at, finished_at}`. Status: `queued\|running\|succeeded\|failed\|cancelled\|unknown` |
| `POST /v1/operations/{id}/cancel` | → `{}` |
| `GET /v1/operations/{id}/results` | **Only** for `finetuning` (checkpoint list: `{data[FineTuningCheckpoint], first_id, last_id, has_more}`, `limit`/`after`) and `dataset_to_file` (`{file_id}`) |
| `GET /v1/operations/{id}/errors` | `{data: string[]}` for failed operations |

- YQL placeholders are inconsistent in the spec examples (`{src_0}`, `{src0}`, `{src_1}`). Call `GET /v1/datasets/{id}/query_templates`
  to get the right form. The SQL dialect beyond "YQL" is not documented.
- Operation results go to `dst` datasets. When `dst` is omitted, "a temporary dataset will be created". How long a `TEMPORARY`
  dataset is kept is **not documented**.

## Prompt presets ([presets])

UI only, with no API in the spec. Save a playground setup (one text-to-text model, playground parameters, system prompt, few-shot
examples; **not** chat history) as a preset. You can reopen it, export it as code, or share a URL (recipients need a Token
Factory account). API-only parameters are not saved.

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[dl]: https://docs.tokenfactory.nebius.com/data-lab/overview
[dl-datasets]: https://docs.tokenfactory.nebius.com/data-lab/datasets
[dl-import]: https://docs.tokenfactory.nebius.com/data-lab/chat-completions
[dl-processing]: https://docs.tokenfactory.nebius.com/data-lab/data-processing
[dl-ft]: https://docs.tokenfactory.nebius.com/data-lab/fine-tuning
[formats]: https://docs.tokenfactory.nebius.com/post-training/datasets
[presets]: https://docs.tokenfactory.nebius.com/utilities/prompt-presets
[legal]: https://docs.tokenfactory.nebius.com/legal/legal-quick-guide
