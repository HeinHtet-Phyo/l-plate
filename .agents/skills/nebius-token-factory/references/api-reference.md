# Token Factory API reference (inference)

Generated on 2026-10-24 from https://api.tokenfactory.nebius.com/openapi.json (version `20261022`), then annotated by
hand. Many field descriptions in the spec are copied from OpenAI's API text, e.g. `store` "for use in our model
distillation". A field being in the schema shows the server **accepts** it, not that it does anything for every
model. Check `supported_features` and `supported_sampling_parameters` in `GET /v1/models?verbose=true`.

Regenerate: download the spec, then run a short script over `components.schemas`. The tables below use
`ChatCompletionRequest`, `ChatCompletionMessage`, `CompletionRequest`, `CreateResponseRequest`, `EmbeddingRequest`,
`RerankRequest`, `RichModel` and `Pricing`.

## All paths in the spec

| Area | Paths |
| --- | --- |
| Inference | `POST /v1/chat/completions`, `POST /v1/completions`, `POST /v1/responses`, `POST /v1/embeddings`, `POST /v1/rerank` |
| Models | `GET /v1/models` (`?verbose=true`, `?ai_project_id=`) |
| Files | `POST/GET /v1/files`, `GET/DELETE /v1/files/{file_id}`, `GET /v1/files/{file_id}/content`, `GET /v1/files/{file_id}/link`. Purposes: `batch`, `fine-tune`, `history` |
| Fine-tuning | `/v1/fine_tuning/jobs`, `/v1/fine_tuning/jobs/{id}` (+ `/cancel`, `/events`, `/checkpoints`, `/checkpoints/{checkpoint_id}`), `GET /v1/fine_tuning/models/spec-draft` |
| Dedicated endpoints | `GET /v0/dedicated_endpoints/templates`, `POST/GET /v0/dedicated_endpoints`, `PATCH/DELETE /v0/dedicated_endpoints/{endpoint_id}` (**v0**) |
| Datasets & operations (Data Lab, batch) | `/v1/datasets…` (incl. multipart uploads), `POST/GET /v1/operations`, `/v1/operations/{id}` (+ `/cancel`, `/results`, `/errors`). Operation types: `yql`, `materialize_history`, `batch_inference`, `finetuning`, `file_to_dataset`, `dataset_to_file`, `merge` |

The skill `nebius-token-factory-custom-models` covers files, fine-tuning, dedicated endpoints, datasets and
operations. Sandboxes have their own API (see `nebius-sandboxes`).

## Enums worth knowing

- `service_tier`: `auto` (default) · `default` (429 instead of going over the limit) · `flex` (lower priority, doesn't
  use rate-limit credit, can still 429) · `no-limit` (undescribed) · `over-limit` is only ever **returned**, never sent.
- `reasoning_effort` (chat): `none` `minimal` `low` `medium` `high` `xhigh` `max`. Responses `reasoning.effort`: the
  same without `max`.
- `response_format.type`: `text` · `json_object` · `json_schema`, with `json_schema: {name, schema, strict?, description?}`.
  The spec's description says only `json_object`/`text` are supported. That's stale text: the enum and the
  [JSON guide](https://docs.tokenfactory.nebius.com/ai-models-inference/json) both include `json_schema`.
- Chat roles: `system` `user` `assistant` `tool` (no `developer`).
- Model `status`: `validating` `active` `error` `deleted`. `quantization`: `int4` `int8` `fp4` `fp6` `fp8` `fp16` `bf16` `fp32`.

## Rate-limit response headers

From the [rate limits](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits) page.

| Header | Meaning |
| --- | --- |
| `x-ratelimit-limit-requests` / `-tokens` | Per-minute cap |
| `x-ratelimit-remaining-requests` / `-tokens` | Left before throttling (tokens refill continuously) |
| `x-ratelimit-reset-requests` / `-tokens` | Seconds until reset |
| `x-ratelimit-dynamic-scale-requests` / `-tokens` | Current dynamic multiplier |
| `x-ratelimit-dynamic-period-remaining` | Seconds to the next adjustment |
| `x-ratelimit-dynamic-period-usage-requests` / `-tokens` | Average use this period, in % |
| `x-ratelimit-over-limit` | `yes` = served from spare capacity, though over the limit |
| `Retry-After` | Seconds to wait after a 429 |

## Status codes (chat, completions, responses)

| Code | Meaning (spec) | Do |
| --- | --- | --- |
| 400 / 422 | Bad request / validation error | Fix the request; don't retry |
| 401 / 403 | Bad key / no access to project or model | Check the key's project |
| 402 | Payment required | Top up, check billing; card failure suspends the account |
| 404 | Unknown model or path | Often a **retired model ID** |
| 429 | Rate limit exceeded | Back off, honour `Retry-After`, or use `service_tier: "flex"` for background work |
| 500 / 503 | Internal / inference service unavailable | Retry with backoff |
| 529 | Inference service overloaded ("endpoints that map overload to 429 return the slow_down 429 instead") | Retry with backoff |

Embeddings and rerank only declare 200 and 422 in the spec. Expect the same auth and limit errors anyway.

## POST /v1/chat/completions: `ChatCompletionRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `model` **(required)** | string | ID of the model to use. |
| `store` | boolean \| null | Whether or not to store the output of this chat completion request for use in our model distillation. |
| `messages` **(required)** | ChatCompletionMessage[] | A list of messages comprising the conversation so far. |
| `max_tokens` | integer \| null | The maximum number of tokens that can be generated in the completion. |
| `max_completion_tokens` | integer \| null | An upper bound for the number of tokens that can be generated for a completion, including visible output tokens and reasoning tokens. |
| `temperature` | number \| null | What sampling temperature to use, between 0 and 2. Default `1`. |
| `top_p` | number \| null | An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. |
| `tools` | ChatCompletionTool[] \| null |  |
| `tool_choice` | `none` \| `auto` \| `required` \| ChatCompletionNamedToolChoice \| null |  |
| `reasoning_effort` | `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` \| `max` \| null |  |
| `n` | integer \| null | How many completions to generate for each prompt. Default `1`. |
| `stream` | boolean \| null | If set, partial message deltas will be sent, like in ChatGPT. Default `false`. |
| `stream_options` | object \| null | If set to {"include_usage": True}, usage stats will be sent with the last chunk of data |
| `stop` | string[] \| null | Up to 4 sequences where the API will stop generating further tokens. |
| `presence_penalty` | number \| null | Number between -2.0 and 2.0. Default `0`. |
| `frequency_penalty` | number \| null | Number between -2.0 and 2.0. Default `0`. |
| `logit_bias` | object \| null | Modify the likelihood of specified tokens appearing in the completion. |
| `logprobs` | boolean \| null | Whether to return log probabilities of the output tokens or not. Default `false`. |
| `top_logprobs` | integer \| null | An non-negative integer specifying the number of most likely tokens to return at each token position, each with an associated log probability. |
| `user` | string \| null | A unique identifier representing your end-user, which can help us to monitor and detect abuse. |
| `response_format` | ResponseFormat \| null | Similar to chat completion, this parameter specifies the format of output. |
| `extra_body` | object \| null | To provide extra parameters. |
| `service_tier` | ServiceTier | The service tier to use for the request. Default `"auto"`. |

## Chat message (`ChatCompletionMessage`)

| Field | Type | Notes |
| --- | --- | --- |
| `role` **(required)** | ChatMessageRole | The role of the author of this message. |
| `content` | string \| (ChatCompletionContentPartTextParam \| ChatCompletionContentPartImageParam \| ChatCompletionContentPartVideoParam)[] \| null | The contents of the message. |
| `name` | string \| null | An optional name for the participant. |
| `tool_calls` | ToolCall[] \| null | The tool calls generated by the model, such as function calls. |
| `tool_call_id` | string \| null | Tool call that this message is responding to. |
| `tools` | any | Moonshot Kimi dynamic-tools extension; forwarded verbatim to the engine. |
| `reasoning_content` | string \| null | The reasoning content of the message. |
| `reasoning` | string \| null | The reasoning content of the message. |
| `partial` | any | Continue generation from a partial (trailing) assistant message; forwarded verbatim to the engine. |

## POST /v1/completions: `CompletionRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `model` **(required)** | string | ID of the model to use. |
| `prompt` **(required)** | string \| string[] \| integer[] | The prompt(s) to generate completions for, encoded as a string, array of strings, array of tokens, or array of token arrays. |
| `stream` | boolean \| null | Enable response streaming. Default `false`. |
| `stream_options` | object \| null | If set to {"include_usage": True}, usage stats will be sent with the last chunk of data |
| `max_tokens` | integer \| null | Max completion token count |
| `temperature` | number \| null | What sampling temperature to use, between 0 and 2. Default `1.0`. |
| `top_p` | number \| null | An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. |
| `n` | integer \| null | How many completions to generate for each prompt. Default `1`. |
| `logprobs` | integer \| null | Include the log probabilities on the `logprobs` most likely tokens, as well the chosen tokens. |
| `echo` | boolean \| null | Echo back the prompt in addition to the completion. Default `false`. |
| `stop` | string \| string[] \| null | Up to 4 sequences where the API will stop generating further tokens. |
| `presence_penalty` | number \| null | Number between -2.0 and 2.0. Default `0.0`. |
| `frequency_penalty` | number \| null | Number between -2.0 and 2.0. Default `0.0`. |
| `logit_bias` | object \| null | Modify the likelihood of specified tokens appearing in the completion. |
| `user` | string \| null | A unique identifier representing your end-user, which can help OpenAI to monitor and detect abuse. |
| `extra_body` | object \| null | To provide extra parameters. |
| `service_tier` | ServiceTier | The service tier to use for the request. Default `"auto"`. |

## POST /v1/responses: `CreateResponseRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `background` | boolean \| null | Whether to run the model response in the background. |
| `input` **(required)** | string \| (EasyInputMessage \| Message \| … (OpenAI's full union))[] | Text, image, or file inputs to the model, used to generate a response. |
| `instructions` | string \| null | A system (or developer) message inserted into the model's context. |
| `max_output_tokens` | integer \| null | An upper bound for the number of tokens that can be generated for a response, including visible output tokens and reasoning tokens. |
| `max_tool_calls` | integer \| null | The maximum number of total calls to built-in tools that can be processed in a response. |
| `metadata` | object \| null | Set of 16 key-value pairs that can be attached to an object. |
| `model` **(required)** | string | The model used for the chat completion. |
| `parallel_tool_calls` | boolean \| null | Whether to allow the model to run tool calls in parallel. |
| `previous_response_id` | string \| null | The unique ID of the previous response to the model. |
| `prompt` | ResponsePrompt \| null | Reference to a prompt template and its variables. |
| `reasoning` | Reasoning \| null | Configuration options for reasoning models. |
| `service_tier` | ServiceTier | The service tier to use for the request. Default `"auto"`. |
| `store` | boolean \| null | Whether to store the generated model response for later retrieval via API. |
| `stream` | boolean \| null | If set to true, the model response data will be streamed to the client as it is generated using server-sent events. |
| `temperature` | number \| null | What sampling temperature to use, between 0 and 2. Default `1`. |
| `text` | ResponseTextConfig \| null | Configuration options for a text response from the model. |
| `tool_choice` | `none` \| `auto` \| `required` \| ToolChoiceAllowed \| ToolChoiceTypes \| ToolChoiceFunction \| ToolChoiceMcp \| ToolChoiceCustom \| ToolChoiceApplyPatch \| ToolChoiceShell | How the model should select which tool (or tools) to use when generating a response. Default `"auto"`. |
| `tools` | (FunctionTool \| FileSearchTool \| ComputerTool \| … (OpenAI's full union))[] | An array of tools the model may call while generating a response. |
| `top_logprobs` | integer \| null | A non-negative integer specifying the number of most likely tokens to return at each token position, each with an associated log probability. |
| `top_p` | number \| null | An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. |
| `truncation` | `auto` \| `disabled` | The truncation strategy to use for the model response. Default `"disabled"`. |
| `user` | string \| null | A unique identifier representing your end-user, which can help us to monitor and detect abuse. |
| `prompt_cache_key` | string \| null | Used by OpenAI to cache responses for similar requests to optimize your cache hit rates. |

## POST /v1/embeddings: `EmbeddingRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `model` **(required)** | string | ID of the model to use. |
| `input` **(required)** | string \| integer[] \| string[] \| integer[][] | Input text to embed, encoded as a string or array of tokens. |
| `encoding_format` | string \| null | The format to return the embeddings in. Default `"float"`. |
| `user` | string \| null | A unique identifier representing your end-user. |
| `service_tier` | ServiceTier | The service tier to use for the request. Default `"auto"`. |
| `dimensions` | integer \| null | The dimensions to use for the request. |

## POST /v1/rerank: `RerankRequest`

| Field | Type | Notes |
| --- | --- | --- |
| `model` **(required)** | string | ID of the model to use. |
| `query` **(required)** | string | Query to rerank, encoded as a string. |
| `documents` **(required)** | string[] | Documents to rerank, encoded as a list of strings. |
| `user` | string \| null | A unique identifier representing your end-user. |
| `service_tier` | ServiceTier | The service tier to use for the request. Default `"auto"`. |

## GET /v1/models?verbose=true: `RichModel`

| Field | Type | Notes |
| --- | --- | --- |
| `id` **(required)** | string |  |
| `name` **(required)** | string |  |
| `created` **(required)** | integer |  |
| `description` **(required)** | string |  |
| `context_length` **(required)** | integer |  |
| `architecture` **(required)** | Architecture |  |
| `quantization` | QuantizationType \| null |  |
| `pricing` **(required)** | Pricing |  |
| `per_request_limits` | object \| null |  |
| `status` | ModelStatus \| null |  |
| `status_reason` | string \| null |  |
| `object` | string |  Default `"model"`. |
| `owned_by` | string |  Default `"system"`. |
| `regions` | RichModelRegion[] \| null |  |
| `supported_features` | string[] \| null |  |
| `supported_sampling_parameters` | string[] \| null |  |

## `Pricing` (USD per unit, as strings)

| Field | Type | Notes |
| --- | --- | --- |
| `prompt` | string |  Default `"0"`. |
| `input_cache_read` | string \| null |  |
| `completion` | string |  Default `"0"`. |
| `image` | string |  Default `"0"`. |
| `price_per_video_second` | string |  Default `"0"`. |
| `request` | string |  Default `"0"`. |
| `price_per_minute` | string |  Default `"0"`. |

