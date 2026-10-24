# Fine-tuning reference (SFT, LoRA, custom speculator, LoRA merge)

As of 2026-10-24. Sources: [sft], [formats], [models], [spec-draft], [merge], [pt], and the OpenAPI spec [spec]
(`20261022-1d60f32ca`), schemas `FineTuningRequest`, `SupervisedHParameters`, `SpecDraftHParameters`,
`FineTuningJob`, `FineTuningJobEvent`, `app__models__fine_tuning__FineTuningJobCheckpoint`, `Metrics`. Re-check by
re-reading those pages and diffing the schemas in a fresh copy of the spec.

What's offered ([pt]): **long-context supervised fine-tuning** on full weights or **LoRA adapters**, and
**custom speculator** training. Reinforcement fine-tuning is a limited professional service you request separately.

## Dataset formats ([formats])

JSONL, one example per line. Size limit: **50 GB via Data Lab, 20 GB via the Files API**.

| Type | Line shape | Rules |
| --- | --- | --- |
| Conversational | `{"messages":[{"role":"system"…},{"role":"user"…},{"role":"assistant"…}]}` | The **last message must be `assistant`** with the final natural-language answer (not a tool call) |
| Conversational + tools | `{"tools":[{type:"function",function:{name,description,parameters}}], "messages":[… assistant `tool_calls` …, {"role":"tool","tool_call_id","name","content"}, {"role":"assistant","content":"…"}]}` | `tools` optional. Use the same schema you'll use at inference |
| Instruction | `{"prompt":"…","completion":"…"}` | |
| Text | `{"text":"…"}` | For unstructured or non-chat data |
| Pretokenized | `{"input_ids":[…],"labels":[…],"attention_mask":[…]}` | `input_ids` required. `labels` optional, `-100` masks loss. `attention_mask` optional. Lengths must match. Tokens must come from the model's default tokenizer (no custom tokens) |

**Use pretokenized** for a custom chat template, a template for a base model that has none, or full control
of tokenization, packing, loss and attention masks ([formats]).

`attention_mask` must be **non-decreasing from 1**, with optional trailing 0 padding. Segment IDs mark packed samples:
`[1,1,2,2,3,3,3]`, `[1,1,1,2,2,3,3,3,0,0,0,0]`. Attention never crosses segments ([formats]).

> **Conflict:** the [formats] schema text says `input_ids`, but its "Valid JSONL examples" use `token_ids`.
> [spec-draft] and the spec's `FineTuningPretokenizedMapping` use `input_ids`. Use `input_ids`.

**Packing** (`packing`, default `true`): combines short samples into one `context_length` sequence and never
truncates a sample. With pretokenized data plus `packing: true`, every sample's `attention_mask` must be all 1s;
Nebius then does the packing. "For some models, `packing = false` is not allowed", and for some large MoE models
packing is mandatory. Which models those are is not documented ([formats]).

## Create-job request (`POST /v1/fine_tuning/jobs`, spec `FineTuningRequest`)

| Field | Req | Notes |
| --- | --- | --- |
| `model` | ✔ | Base model ID from [models] |
| `training_file` | ✔ | File ID from `POST /v1/files` with `purpose: "fine-tune"` |
| `validation_file` | | Same format as training |
| `hyperparameters` | | `SupervisedHParameters` (below). Omitted fields use defaults |
| `method` | | `{type:"supervised", supervised:{hyperparameters}}` or `{type:"spec-draft", spec_draft:{hyperparameters}}`. In the Data Lab operations API, top-level `hyperparameters` is marked "legacy field, use method instead" (spec `FineTuningParams`). Precedence if you send both: not documented |
| `integrations` | | Array of `wandb` / `mlflow` / `hf` objects (below) |
| `from_checkpoint` | | "Checkpoint to continue training from": `{type:"hf", repo, revision?, token?}` or `{type:"ft"}`. The `ft` variant has no ID field, so what it refers to is not documented. Spec only, no prose |
| `seed` | | Same seed + data + params → better reproducibility ([sft]) |
| `suffix` | | ≤64 chars (spec). Appended to the output model name |
| `tags` | | String array (spec only) |
| `extra_body` | | Free-form object, "extra params to pass to the fine-tuning job" (spec only) |

Query parameter: `ai_project_id` (optional).

### Supervised hyperparameters

| Name | Spec range · default | Prose ([sft]) |
| --- | --- | --- |
| `batch_size` | 1–64 · 8 | "typical 8–32"; larger needs more VRAM |
| `learning_rate` | ≥0 · 1e-5 | typical 1e-6 to 5e-5 |
| `n_epochs` | 1–20 · 3 | more epochs → more overfitting risk |
| `warmup_ratio` | 0–1 · 0 | linear warmup |
| `weight_decay` | ≥0 · 0 | |
| `packing` | bool · true | |
| `max_grad_norm` | **>0** · 1.0 | prose says "≥ 0" (conflict) |
| `context_length` | **8192–131072** · 8192 | [models]: 8192, 16384, 32768, 65536, 131072. Longer inputs **error**, they aren't truncated. Pick the P95–P99 length |
| `lora` | bool · **false** (full fine-tune) | |
| `lora_r` | 8–128 · 8 | |
| `lora_alpha` | ≥8 · 8 | |
| `lora_dropout` | 0–1 · 0 | |

### Integrations

| `type` | Fields (spec) | Prose |
| --- | --- | --- |
| `wandb` | `wandb: {project (req), api_key (req, write-only), name?, entity?, tags?}` | [sft] omits `api_key`. **Conflict:** a request copied from the docs may fail validation (unverified) |
| `hf` | `hf: {output_repo_name (req), api_token (req, write-only)}` | HF token with write access to the repo |
| `mlflow` | `mlflow: {tracking_uri, experiment_name, run_name, certificate_file, username, password (write-only)}` all required; `tags`, `certificate_file_id` optional | Not mentioned in prose |

The prose says "Currently supported: `wandb`" and then documents `hf` ([sft]).

## Job object, events, checkpoints

- **Job** (spec `FineTuningJob`): `id`, `status`, `model`, `training_file`, `validation_file`, `hyperparameters`, `method`,
  `integrations` (the spec's `*ConfigResponse` schemas leave out `api_key`/`api_token`/`password`, although the
  [sft] example job object shows `hf.api_token`), `from_checkpoint`, `error {code, message, param}`, `result_files`,
  `trained_tokens` ("billable tokens", spec `FineTuningParams`), `trained_steps`, `total_steps`, `estimated_finish`,
  `created_at`, `finished_at`, `suffix`, `seed`.
- **Status:** `validating_files` → `queued` → `running` → `succeeded` | `failed` | `cancelled` (spec enum).
  `POST /v1/fine_tuning/jobs/{id}/cancel` "immediately" cancels.
- **Events** (`GET …/events?limit&after`): `{id, created_at, level: info|warn|error, message, type: message|metrics,
  data}`. Example messages: "Job is submitted", "Dataset '<file_ID>' processed successfully", "Training completed
  successfully" ([sft]).
- **Checkpoints** (`GET …/checkpoints?limit&after`, or `…/checkpoints/{checkpoint_id}`): `{id, step_number,
  fine_tuned_model_checkpoint, metrics, result_files[]}`. The single-checkpoint response schema has **no
  `result_files`** (spec uses the OpenAI type there), so use the list call to get files. Checkpoints are "often per
  epoch". The final one is "usually the last one in the list" ([sft]).
- **Metrics** (spec `Metrics`): `train_loss`, `valid_loss`, `full_valid_loss`, `train_mean_token_accuracy`,
  `valid_mean_token_accuracy`, `full_valid_mean_token_accuracy`, `step`.
- **Artefacts:** each `result_files` ID → `GET /v1/files/{id}` (`filename` such as `<checkpoint_ID>/adapter_config.json`)
  → `GET /v1/files/{id}/content` (raw bytes), or `GET /v1/files/{id}/link` → `{url}`.
- `fine_tuned_model_checkpoint` example: `ft:meta-llama/Llama-3.1-8B-Instruct-2025-02-25:org_placeholder::IDPlaceholder:ckpt-step-3`
  ([sft]). Whether it can be used as a serverless `model` is **not documented**. [models] says fine-tuned
  models deploy via dedicated endpoints only.

Python (docs only): [sft] §1–7 use `openai` with `base_url="https://api.tokenfactory.nebius.com/v1/"`. Its poll loop
condition is inverted (see SKILL.md).

## Trainable models (snapshot of [models], as of 2026-10-24)

To re-check, re-read [models]. There is no list API for SFT; spec-draft models are listed by `GET /v1/fine_tuning/models/spec-draft`.

| Family | Model IDs | LoRA | Full |
| --- | --- | --- | --- |
| DeepSeek (MIT) | `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/DeepSeek-V4-Flash` | – | ✔ |
| Google Gemma 4 (Apache 2.0) | `google/gemma-4-E2B-it`, `google/gemma-4-E4B-it`, `google/gemma-4-31B-it` | – | ✔ |
| GPT-OSS by Unsloth, bf16 (Apache 2.0) | `unsloth/gpt-oss-20b-BF16`, `unsloth/gpt-oss-120b-BF16` | ✔ | ✔ |
| Qwen3 MoE | `Qwen/Qwen3-235B-A22B`, `-Instruct-2507`, `-Thinking-2507`; `Qwen/Qwen3-30B-A3B`, `-Instruct-2507`, `-Thinking-2507` | ✔ | ✔ |
| Qwen3 Coder | `Qwen/Qwen3-Coder-30B-A3B-Instruct`, `Qwen/Qwen3-Coder-480B-A35B-Instruct` | ✔ | ✔ |
| Qwen3 dense | `Qwen/Qwen3-{32B,14B,8B,4B,1.7B,0.6B}` and `-Base` of 14B/8B/4B/1.7B/0.6B | ✔ | ✔ |
| Qwen3.5 / 3.6 | `Qwen/Qwen3.5-27B`, `Qwen/Qwen3.6-27B` | – | ✔ |
| Qwen2.5 | `Qwen/Qwen2.5-{0.5B,7B,14B,32B,72B}` and `-Instruct`; `Qwen/Qwen2.5-Coder-32B`, `-Instruct` | ✔ | ✔ |
| Meta Llama 3.x (Llama Community Licenses) | `meta-llama/Meta-Llama-3.1-8B-Instruct`, `meta-llama/Meta-Llama-3.1-8B`, `meta-llama/Llama-3.1-70B-Instruct`, `meta-llama/Llama-3.1-70B`, `meta-llama/Llama-3.2-{1B,3B}` and `-Instruct`, `meta-llama/Llama-3.3-70B-Instruct` | ✔ | ✔ |

Notes:
- The 8B Llama IDs on [models] use the `Meta-` prefix, but [sft] and the spec examples use `meta-llama/Llama-3.1-8B-Instruct`. Which ID the API
  accepts isn't documented.
- GPT-OSS: to convert weights to MXFP4, [models] links `post-training/weights-conversion`. That page was not in the 2026-10-24 download.
- Being trainable doesn't mean a model is on serverless. `Qwen/Qwen3-32B`, `meta-llama/Llama-3.3-70B-Instruct` and
  `deepseek-ai/DeepSeek-V4-Flash` left serverless on 2026-08-31 ([aug]).

## Custom speculator ([spec-draft])

Trains an EAGLE-style drafter for a base model. Same endpoint: `POST /v1/fine_tuning/jobs` with
`method: {type: "spec-draft", spec_draft: {hyperparameters}}`. Required top-level fields: `model`, `training_file`, `method`.

- **Data: pretokenized only**, with `input_ids`, `attention_mask`, `labels` (-100 = ignore).
- Which models can be trained: `GET /v1/fine_tuning/models/spec-draft` (also served unversioned at `/fine_tuning/models/spec-draft`)
  → `{models: [{hf_repo_name, huggingface_url, size_b, context_window_k, quantization, description, license, price: {sku_id, value}}]}`.
  The price unit is not documented. The docs example uses `Qwen/Qwen3-30B-A3B-Instruct-2507`.

| Hyperparameter | Spec range · default | Prose |
| --- | --- | --- |
| `batch_size` | 1–64 · 8 | "large (e.g. 32) recommended" |
| `learning_rate` | (0, 1) exclusive · 0.0075 | 0.0075 for models under 100B; lower for larger ones |
| `n_epochs` | 1–20 · 1 | |
| `warmup_ratio` · `max_grad_norm` · `context_length` | 0–1 · 0 / >0 · 1.0 / 8192–131072 · 8192 | |
| `weight_decay` · `packing` | ≥0 · 0 / bool · true | spec only |
| `num_decoding_heads` | **1–10** · 3 | **1–7** (conflict) |
| `architecture` | string · `eagle3_original` | `eagle3_original` (reference, portable to any vLLM platform) or `eagle3` (Token Factory-optimised, **serves only on Token Factory**) |
| `loss.type` | `kl` · `lk_alpha` · `lk_hybrid` (default `kl`) | `lk_alpha` = LK with KL disabled; `lk_hybrid` = weighted KL + LK |

- **Metrics:** per-head `lk`, `kl`, `cross_entropy`, plus `target_model_loss` and `draft_loss` (all are reported whatever the
  loss type). Per-head sampling metrics `acceptance_rate`, `number_of_tokens` and `system_efficiency` are conditional on earlier
  heads being accepted. The "default" variation uses `temperature=1.0`.
- **Output:** `checkpoint/model.safetensors` + `config.json`. Download it like SFT checkpoints.
- **Serving** (vLLM): `vllm serve <base> --speculative-config '{"model": "<drafter dir>", "num_speculative_tokens": 3,
  "method": "eagle3"}'`. Eagle ties weights across heads, so only one head is stored. Any `num_speculative_tokens`
  from 1 to N works, but performance is best at ≤ the number of trained heads. Set it near the observed acceptance length:
  for example, if 7 yields about 3.86, use 3–4.

## Merging LoRA adapters ([merge])

Use this to bake a LoRA adapter into the base weights, producing a standard safetensors checkpoint (vLLM, or a
dedicated endpoint with custom weights). [models] points GPT-OSS MoE LoRA users here before deploying on dedicated endpoints.

1. `pip install safetensors huggingface_hub transformers peft` (the script also imports `torch`).
2. Download the **exact** base model used for training, e.g. `hf download unsloth/gpt-oss-20b-BF16 --local-dir gpt-oss-20b-BF16`.
3. Download the adapter directory (`adapter_model.safetensors`, `adapter_config.json`) from the UI or the files API.
4. Save the page's `merge_lora.py` (about 150 lines; copy it from [merge], it isn't reproduced here) and run
   `python merge_lora.py --orig_ckpt_path gpt-oss-20b-BF16 --lora_ckpt_path my-lora-adapter --output_ckpt_path gpt-oss-20b-BF16-lora-merged`.
   The merge is `W + (lora_alpha / r) · (B @ A)`.
- By default it only merges `ALLOWED_LORA_LAYERS = [r"model.layers.*.self_attn"]`. Extend that if you trained other modules (e.g. MLPs).
  The script **fails** if an adapter tensor matches no allowed pattern or stays unmerged. All non-safetensors files are copied over.
- The script's docstring calls it `merge_weights.py` with `-i/-l/-o`. The flags are the same, only the file name differs.

## Data location, privacy, ownership ([legal])

- Fine-tuning datasets, artefacts and outputs are **stored in the EU** for every customer. Jobs are **processed in the EU
  for EU users and the US for US users**. There is no region choice (§5.3). [dl-ft] says jobs run "in EU or US data centers".
- Nebius acts as data processor for training data (§3.2). You own your datasets and fine-tuned or distilled models (§11).
- Permissions: project Admin and Member both have "Full Access" to the Fine-tuning and Files APIs ([groups]).

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[pt]: https://docs.tokenfactory.nebius.com/post-training/overview
[sft]: https://docs.tokenfactory.nebius.com/post-training/how-to-fine-tune
[formats]: https://docs.tokenfactory.nebius.com/post-training/datasets
[models]: https://docs.tokenfactory.nebius.com/post-training/models
[spec-draft]: https://docs.tokenfactory.nebius.com/post-training/custom-speculator
[merge]: https://docs.tokenfactory.nebius.com/post-training/merge-moe-lora-weights
[dl-ft]: https://docs.tokenfactory.nebius.com/data-lab/fine-tuning
[legal]: https://docs.tokenfactory.nebius.com/legal/legal-quick-guide
[groups]: https://docs.tokenfactory.nebius.com/team-access/groups
[aug]: https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice
