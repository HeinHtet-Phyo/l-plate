# Dedicated endpoints reference

As of 2026-10-24. Sources: the 13 pages under `ai-models-inference/dedicated-endpoints/` (linked below), [obs],
[cached], [legal], and the OpenAPI spec [spec] (`20261022-1d60f32ca`), schemas `DedicatedEndpointCreateRequest`,
`DedicatedEndpointUpdateRequest`, `DedicatedEndpoint`, `EndpointDeploymentStatus`, `ModelsListResponse`,
`SupportedGPU`, `SupportedRegion`, `ReservationPolicy`. To re-check, re-read the pages and diff those schemas.

## Concepts ([planes])

| Term | Meaning |
| --- | --- |
| Template | A deployable "blueprint" for a model: which `flavor_name`, `gpu_type` and regions are supported |
| Flavor | A template sub-option, e.g. `base`, `fast`, with different performance, throughput and cost |
| `endpoint_id` | Used for update and delete. **In the spec it's the field `id`** (uuid) |
| `routing_key` | The `model` value for inference calls. Returned on create. The spec lets you set it yourself: 12–128 chars, must start `dedicated/` |
| Control plane | Create, update, scale, monitor. One base URL: `https://api.tokenfactory.nebius.com` |
| Data plane | Inference, at a regional base URL (below) |

Key use cases ([ov]): predictable capacity, a fine-tuned base model with custom weights, compliance or private infra, more
control. Compared with serverless: reserved vs shared capacity, no standard rate limits vs dynamic ones, a fixed user-chosen
region vs a changing one, custom weights "for eligible models" vs base models only, and per GPU-hour (per-minute granularity)
vs per-token pricing ([ov]).

Before you start ([quickstart]): billing enabled with enough balance, an API key, and a supported model.
UI path: Explore page or **Inference → Model Endpoints** (https://tokenfactory.nebius.com/endpoints). The endpoint card shows its ID,
routing key, model, GPUs per replica, min/max replicas, status and code snippets ([deploy-ui]).

## Regions and URLs

| Region | Inference base URL ([planes]) |
| --- | --- |
| `eu-north1` | `https://api.tokenfactory.nebius.com` |
| `eu-west1` | `https://api.tokenfactory.eu-west1.nebius.com` |
| `us-central1` | `https://api.tokenfactory.us-central1.nebius.com` |

- [operating] lists only these three regions. The spec's `SupportedRegion` enum has 16 (see `api.md`). Templates
  (`allowed_regions`) decide what you can actually use. Data-plane URLs for the other regions are **not documented**.
- `region` **can't be changed** after creation ([operating]).
- Inference runs only in the chosen region, with no multi-region routing or failover, and this is a DPA §6.1 commitment ([legal] §5.2).
- Region choice depends on capacity. To reserve capacity in a specific region, contact Sales ([faq]).

## GPU types (spec `SupportedGPU`)

`gpu-l40s-d`, `gpu-l40s-a`, `gpu-h100-sxm`, `gpu-h200-sxm`, `gpu-b200-sxm`, `gpu-b200-sxm-a`, `gpu-b300-sxm`.
Not every type is always available; availability depends on regional capacity ([capacity]). What each type is suited to,
or what it costs, is **not documented** beyond the "higher-end vs mid-range" guidance below.

## Templates: `GET /v0/dedicated_endpoints/templates`

The response (spec `ModelsListResponse`) is the source of truth for valid combinations ([deploy-api]):

```text
data[]: {
  name, type,
  metadata: { vendor, context_window_k, size_b, huggingface_url?, license? }   // text2text shape; also embedding/image2text/rerank
  flavors: { <flavor_name>: {
      quantization, use_cases[], tags[], base_model_slug,
      available_configurations: { gpu_configurations: { <gpu_type>: {
          allowed_regions[], allowed_gpu_counts[], max_replicas_allowed } } } } }
}
```

There are **no prices** in the template response. "Today, publicly available templates are primarily chat-capable" ([deploy-api]).
To request a model that has no template, contact Support with the Hugging Face link and your traffic details ([faq]).

## Create: `POST /v0/dedicated_endpoints` → 201 `{ endpoint }`

| Field | Req | Spec constraint | Notes |
| --- | --- | --- | --- |
| `name` | ✔ | 1–100 chars | |
| `description` | | ≤500, default "" | |
| `model_name` | ✔ | | Template name, e.g. `openai/gpt-oss-20b`, `openai/gpt-oss-120b` ([deploy-api], [operating]) |
| `flavor_name` | ✔ | | e.g. `base`, `fast` |
| `gpu_type` | ✔ | `SupportedGPU` | Must be allowed for the template + flavor |
| `gpu_count` | ✔ | integer ≥0 | GPUs **per replica**. Max total GPUs = `gpu_count × scaling.max_replicas` ([operating]) |
| `region` | ✔ | `SupportedRegion` | Immutable |
| `scaling` | ✔ | `{min_replicas ≥1, max_replicas ≥1}` | |
| `routing_key` | | 12–128 chars, prefix `dedicated/` | Optional in the spec. The prose never sets one, only says it's "returned when you create an endpoint" ([planes]) |
| `custom_weights_id` | | non-empty string | Spec only. Custom weights are **beta, on request** ([custom-weights]); how to get an ID is not documented |
| `reservation_policy` | | `{policy: AUTO\|FORBID\|STRICT, reservation_ids[]}` | Spec only. Semantics are not documented; the prose only says to contact Sales for reserved capacity ([capacity]) |

Query parameter: `ai_project_id`. The [operating] table also lists `enabled` as a parameter, but the spec's create
request has **no `enabled`**. It exists only on PATCH.

Endpoint object (spec `DedicatedEndpoint`): `id`, `name`, `description`, `enabled`, `routing_key`, `model_name`,
`flavor_name`, `region`, `gpu_type`, `gpu_count`, `custom_weights_id`, `scaling`, `reservation_policy`,
`deployment {ready_replicas, status, readiness}`, `created_at` (ISO date-time).

## Read, update, delete

- **List:** `GET /v0/dedicated_endpoints` → `{data: DedicatedEndpoint[]}`. **There is no GET-by-id**, so filter the list.
- **Update:** `PATCH /v0/dedicated_endpoints/{endpoint_id}` changes only the fields you send ([operating]). The spec allows
  `name`, `description`, `routing_key`, `enabled`, `gpu_type`, `gpu_count`, `scaling`, `custom_weights_id`, and returns the
  endpoint. Scaling changes may provision replicas, so expect a short warm-up ([operating]).
  - `enabled: false` stops the endpoint and frees its replicas; `true` starts it again ([operating], [faq]).
- **Delete:** `DELETE /v0/dedicated_endpoints/{endpoint_id}` → 200 `{}`. It's permanent, and the min-replica GPUs are released to other users.

Python for each call is in [deploy-api] and [operating] (`requests`, `CONTROL_PLANE_BASE_URL`, `API_TOKEN`).

## Status ([lifecycle]; spec `EndpointDeploymentStatus`)

There are two independent axes: **lifecycle** (deployment stage) and **readiness** (can it serve). "Use Readiness to decide
whether to send traffic."

| Lifecycle (spec / prose) | Meaning |
| --- | --- |
| `starting` / Starting | Being created or started; traffic may not be available yet |
| `updating` / Updating | Applying config; traffic may continue with reduced capacity |
| `running` / Running | Deployed |
| `error` / "Warning" (heading) or "Error" (table) | Deployment issue; may still serve depending on readiness. **Contact support if it lasts >3 h** |
| `stopping` / Stopping | Stop requested, shutting down |
| `stopped` / Stopped | Intentionally disabled |

| Readiness (spec / prose) | Meaning |
| --- | --- |
| `not_ready` / Not ready | Can't reliably serve. Expected during starting/stopping/stopped |
| `partially_ready` / Partially ready | Serves, but below expected capacity. **Contact support if it lasts >3 h** |
| `ready` / Ready | Fully provisioned |

Documented combinations: starting+not_ready = provisioning · starting+partially_ready = serving while scaling ·
updating+ready = normal during update · running+ready = fully operational · running+partially_ready = degraded ·
running+not_ready = unexpected outage · error+ready = serving with a deployment issue · error+not_ready = deployment failure ·
stopping+partially_ready = shutting down · stopped+not_ready = fully stopped.

## Billing ([billing], [ov], [cached])

- Price model: per GPU-hour, billed with per-minute granularity. **Rates aren't documented** in the pages or the spec.
- Billable only while **≥1 replica is running**. With zero replicas running, the endpoint is inaccessible and not billed. Contracts may differ.
- Not billed: capacity provisioning, `not ready`, `partially ready`, replica restarts, graceful shutdown for a rolling
  update, endpoint stop. Billed: capacity provisioned with `ready` status. **Ambiguous:** "partially ready" is
  listed as not billed, yet the page also says billing applies whenever ≥1 replica is running.
- Autoscaling above or below min adjusts billing pay-as-you-go.
- Prompt caching works (with a per-customer isolated cache), but there is no cached-input price, because billing is per GPU-hour ([cached]).
- Observability dashboards are "not for billing reconciliation" ([obs]). Usage is under Organisation → Usage ([billing-new]).

## Capacity and SLA ([capacity], [best])

- Self-service endpoints run on **on-demand** Nebius AI Cloud capacity from a shared pool, **not a long-term reservation**.
- Stopping releases the GPUs, **whatever the cause** (you, an incident, scheduled or emergency maintenance). On restart, capacity is
  requested again. The endpoint may sit in Starting/Not ready or reach only Partially ready, and restarting can take
  **much longer than the first deploy** for scarce GPUs or at busy times.
- Min replicas: reserved and non-preemptible **while active**. Max replicas: burst, "not guaranteed indefinitely",
  and may be reclaimed after scale-down.
- No formal SLA unless contracted. Historical average monthly request success rate is about 99.9%. For guaranteed capacity, contact Sales.
- Sizing rules of thumb ([best]): GPU type × `gpu_count` sets per-replica performance; replicas set concurrency and
  availability. Start with the smallest GPU type that fits the model and region, and scale GPU type or `gpu_count` before adding
  replicas. More replicas don't fix slow single requests. `min_replicas` = what you always need (higher if traffic is steady,
  latency matters, or cold starts are unacceptable); `max_replicas` = peak headroom (lower if you need budget control).

## Errors ([faq])

| Status | Typical cause | Fix |
| --- | --- | --- |
| 401 | Missing or invalid token | Set `Authorization: Bearer …` |
| 403 | Token lacks permission | Use a key with dedicated-endpoint permissions |
| 404 | Not ready yet, wrong regional domain, or wrong `routing_key` | Wait for readiness; use the region's base URL; pass `routing_key` exactly |
| 409 | Capacity or config conflict | Pick a combo from templates, or lower `max_replicas` |
| 422 | Invalid payload | Validate against templates (GPU types, flavors, regions, counts) |

## Observability ([obs])

**Only dedicated endpoints** get metrics. Find them under Inference → Observability, or the endpoint card → Observability.
- Traffic: RPM, input/output tokens per minute, tokens per request, KV-cache hit rate.
- Latency: e2e, TTFT (streaming only), output TPS, at p50/p90/p99.
- Capacity: active replicas, active GPUs, GPU utilisation (average and busiest).
- Errors: error rate by status code.

Filters: time, endpoint, project, API key, region, error code, prompt length, latency. Metrics are exported via
Prometheus and Grafana integrations (`ai-models-inference/observability-api-integrations`). Status page: https://status.nebius.com.

## Custom weights ([custom-weights], [faq])

"Currently in beta and available on request." Contact Support (https://tokenfactory.nebius.com/?modals=contact-us).
Availability, supported configurations and onboarding may vary. The control plane is described as handling "Uploading
models / weights" ([planes]), but **no upload endpoint appears in the spec**. The only hook is `custom_weights_id` on create and PATCH.

## Other

- Serverless deprecations (June 22 and August 31, 2026) **did not affect dedicated endpoints** ([aug]).
- Projects own dedicated endpoints. Admin and Member groups both have "Full Access" to the Dedicated Endpoints API ([groups]).

[spec]: https://api.tokenfactory.nebius.com/openapi.json
[ov]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/overview
[quickstart]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/quickstart
[deploy-ui]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/deploy-ui
[deploy-api]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/deploy-api
[operating]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/operating
[lifecycle]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/lifecycle-and-status
[planes]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/control-data-plane
[capacity]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/capacity-and-scaling
[billing]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/billing-policy
[best]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/best-practice
[faq]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/faq
[custom-weights]: https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/custom-weights
[obs]: https://docs.tokenfactory.nebius.com/ai-models-inference/observability
[cached]: https://docs.tokenfactory.nebius.com/cached-tokens
[legal]: https://docs.tokenfactory.nebius.com/legal/legal-quick-guide
[billing-new]: https://docs.tokenfactory.nebius.com/other-capabilities/billing-new
[groups]: https://docs.tokenfactory.nebius.com/team-access/groups
[aug]: https://docs.tokenfactory.nebius.com/august-2026-deprecation-notice
