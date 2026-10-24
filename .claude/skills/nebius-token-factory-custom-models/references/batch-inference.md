# Batch inference reference

As of 2026-10-24. Sources: the OpenAPI spec [spec] (`20261022-1d60f32ca`), schemas `CreateBatchInferenceOperationRequest`,
`BatchInferenceParams`, `BatchInferenceMessagesMapping`, `BatchInferenceInputMapping`, `BatchInferenceBodyMapping`,
`Mapping{Column,Text,Number,Constant}`, `CreateOperationSrcDataset`, `OperationResponse`, `CreateDatasetToFileOperationRequest`,
`FilePurpose`. Also [dl], [dl-processing], [rate], [groups], [files-ex], [cached]. **No prose page explains how to run a
batch job.** Everything about the request shape comes from the spec and was not run live. To re-check, search a fresh
spec for `batch` and the docs index for a batch page.

## What exists and what doesn't

| Claim | Where | Reality in the spec |
| --- | --- | --- |
| "Use **Batch API** for async workloads, it has significantly higher limits. Read more" | [rate] (the "Read more" has no target) | **No `/v1/batches` path.** No limits given |
| "Batch API: Full Access" for project Admin and Member | [groups] | Same: no such endpoint |
| Upload `batch-requests.jsonl` with `purpose="batch"`, then download "batch_result" via `GET /v1/files/{id}/content` | [files-ex] | `FilePurpose` does include `batch`, but nothing in the spec takes a batch file and starts a job |
| Data Lab stores "batch inference outputs" and "datasets created from completed batch jobs" | [dl], [dl-processing] | ✔ Matches `POST /v1/operations` with `type: "batch_inference"` |

So **the only documented way to run a batch is the Data Lab operation below.** Treat any OpenAI-style
`client.batches.create(...)` flow as **unverified**: the prose implies it, but neither the prose nor the spec documents it.

## Request: `POST /v1/operations`

```text
{ type: "batch_inference",
  params: { model (req), completion_window (req, string) },
  src:    [ { id (req), version (req key, may be null), mapping } ],   // CreateOperationSrcDataset
  dst?:   [ { id, version } ],          // omitted → "a temporary dataset will be created"
  ai_project_id? }
```

- `params.model`: "ID of the model to use". The spec example is `meta-llama/Meta-Llama-3.1-70B-Instruct`. Which models
  support batch, and whether a dedicated `routing_key` works here, is **not documented**.
- `params.completion_window`: a free string. **Allowed values are not documented**; the only example is `"12h"`.
- Response: `CreateOperationResponse {id, type, params, src, dst, status, created_at, in_progress_at, finished_at}`.

### `mapping` (one per source dataset)

Every mapping value is a record: `{type:"column", name}` reads a dataset column, `{type:"text", value}` is a constant
string, `{type:"number", value}` is a constant integer. (`{type:"constant", value}` appears only in the *response* schema.)

| `mapping.type` | Fields | For |
| --- | --- | --- |
| `text_messages` (default) | `messages` (req, column or text), `max_tokens?` (number, column or text), `custom_id?` (column) | Chat-style requests from a column of message arrays |
| `embeddings` | `input` (req, column), `encoding_format?` (text or column), `dimensions?` (number or column), `custom_id?` (column) | Embedding jobs |
| `body` | `body` (req, column), `custom_id?` (column) | A full request body per row. The body's schema is not documented |

Spec examples: `{type:"text_messages", messages:{type:"column", name:"chat_messages"}}`,
`{type:"embeddings", input:{type:"column", name:"input"}}`,
`{type:"body", body:{type:"column", name:"body"}, custom_id:{type:"column", name:"custom_id"}}`.

## Lifecycle and results

1. `GET /v1/operations/{id}`. Status: `queued | running | succeeded | failed | cancelled | unknown`. The poll interval is not documented.
2. On failure: `GET /v1/operations/{id}/errors` → `{data: string[]}`. To cancel: `POST /v1/operations/{id}/cancel`.
3. **Output is the `dst` dataset**, listed in the operation's `dst[]`. Read it with `GET /v1/datasets/{dst_id}/content?limit&offset`
   (1–1000 rows per page) or `GET /v1/datasets/{dst_id}/export?format=jsonl|csv`. The output columns are **not documented**,
   so inspect `schema` from `GET /v1/datasets/{dst_id}` first.
4. **`GET /v1/operations/{id}/results` is not for batch.** The spec describes it as "Get checkpoints for a fine-tuning operation
   or the output file id for a dataset-to-file operation". Its response is one of those two shapes. To get a file,
   run a `dataset_to_file` operation on the output dataset and then call `/results` → `{file_id}` → `GET /v1/files/{file_id}/content`.
   Whether `purpose: "inference"` is the right export for batch *outputs* (the spec says "Model id for inference batch
   export") is not documented.

## Minimal TypeScript (Node 24 fetch, spec-derived, not run)

```ts
const BASE = "https://api.tokenfactory.nebius.com";
const H = { Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`, "Content-Type": "application/json" };
async function call<T>(p: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + p, { ...init, headers: H });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${p} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. Source: an existing Data Lab dataset with columns `custom_id` and `messages` (e.g. uploaded as JSONL in the UI).
type Ds = { id: string; current_version_summary?: { id: string } | null; current_version?: string | null };
const ds = await call<Ds>(`/v1/datasets/${process.env.DATASET_ID}`);
const version = ds.current_version_summary?.id ?? ds.current_version ?? null; // current_version is deprecated

// 2. Start the batch.
const op = await call<{ id: string }>("/v1/operations", { method: "POST", body: JSON.stringify({
  type: "batch_inference",
  params: { model: process.env.BATCH_MODEL, completion_window: "12h" }, // "12h" = the spec's only example
  src: [{ id: ds.id, version, mapping: {
    type: "text_messages",
    messages: { type: "column", name: "messages" },
    max_tokens: { type: "number", value: 512 },
    custom_id: { type: "column", name: "custom_id" },
  } }],
}) });

// 3. Poll.
type Op = { status: string; dst: { id: string; version: string | null }[] };
let cur: Op;
do { await sleep(60_000); cur = await call<Op>(`/v1/operations/${op.id}`); }
while (cur.status === "queued" || cur.status === "running");
if (cur.status !== "succeeded") throw new Error(JSON.stringify(await call(`/v1/operations/${op.id}/errors`)));

// 4. Read the output dataset as JSONL.
const res = await fetch(`${BASE}/v1/datasets/${cur.dst[0].id}/export?format=jsonl`, { headers: H });
const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
```

Building the source dataset inline (small jobs): `POST /v1/datasets` with `{name, folder, schema, rows}`. The spec
doesn't say which column type batch expects for `messages`. `json` is the obvious `SchemaPrimitiveType`, but that is
**unverified**, so check by creating the dataset and inspecting it before relying on it.

## Limits, cost, retention

- **Limits:** only "significantly higher" than real-time limits ([rate]). No numbers anywhere.
- **Price:** not documented. Cached-input pricing doesn't apply to batch ([cached]: "Batch inference is not covered").
- **Retention:** "Datasets created from completed batch jobs: kept until you delete them" ([dl-processing]). The
  temporary dataset created when `dst` is omitted has status `TEMPORARY`; its lifetime is **not documented**, so pass `dst`
  or export results promptly.
- **Location:** Data Lab handles batch outputs only in EU-North1 (Finland) ([dl-processing]). Where the inference itself
  runs is not documented.
- **Permissions:** project Admin and Member both have "Full Access" to the "Batch API" ([groups]).

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[dl]: https://docs.tokenfactory.nebius.com/data-lab/overview
[dl-processing]: https://docs.tokenfactory.nebius.com/data-lab/data-processing
[rate]: https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits
[groups]: https://docs.tokenfactory.nebius.com/team-access/groups
[files-ex]: https://docs.tokenfactory.nebius.com/api-reference/examples/files
[cached]: https://docs.tokenfactory.nebius.com/cached-tokens
