---
name: nebius-corrections
description: Start here for anything Nebius. Says which nebius-* skill fits (Token Factory inference, fine-tuning/dedicated endpoints, Sandboxes, or the AI Cloud CLI, compute, quotas, billing, Serverless AI, Devlabs), and lists verified corrections that OVERRIDE the nebius-cloud plugin's skills, plus this hackathon repo's rules for Nebius keys, cost and data.
---

# Nebius: which skill, corrections & build notes

Nebius sells two separate products. **Token Factory** (https://docs.tokenfactory.nebius.com) is an
OpenAI-compatible inference and fine-tuning API for open models; you authenticate with a **project API key**.
**Nebius AI Cloud** (https://docs.nebius.com) is GPUs, VMs, Kubernetes, storage and Serverless AI, run through the
`nebius` CLI; you authenticate with **IAM (user or service-account) tokens**. The consoles, docs and credentials are
all different, so pick the product first.

## Which skill

| Task | Skill | Owner |
| --- | --- | --- |
| **Hackathon quick start**: setup check, model shortlist, structured output, comparison harness, judging lens | `token-factory` | repo |
| Call an open model: chat, Responses, embeddings, rerank, vision, tools, JSON output, rate limits, caching, ZDR | `nebius-token-factory` | repo |
| Fine-tune (SFT/LoRA), dedicated endpoints, custom weights, Data Lab, **batch inference** | `nebius-token-factory-custom-models` | repo |
| Run untrusted or agent code in VM sandboxes (ConTree) | `nebius-sandboxes` | repo |
| Set up or check the `nebius` CLI, profiles, `--parent-id`, output formats | `nebius-cloud-basics` | plugin |
| "Does AI Cloud support X?" with doc links | `nebius-public-docs` | plugin |
| A failed CLI, Terraform or SDK call | `nebius-api-debug` | plugin |
| List VMs, disks, platforms, images | `nebius-compute-inventory` | plugin |
| Create, resize or stop VMs, disks, GPU clusters | `nebius-compute-provision` | plugin |
| GPU capacity, quotas, reservations | `nebius-capacity-quotas` | plugin |
| Price estimates, spot price caps | `nebius-billing` | plugin |
| CI or agent auth for Serverless | `nebius-serverless-setup` | plugin |
| Container jobs on GPUs/CPUs | `nebius-serverless-jobs` | plugin |
| Host a model or container behind HTTPS (e.g. vLLM) | `nebius-serverless-endpoints` | plugin |
| Buckets, secrets, registries for jobs/endpoints | `nebius-serverless-data-secrets` | plugin |
| End-to-end Serverless playbooks (**reference only**: 4 of 7 recipes fail as written, see below) | `nebius-serverless-recipes` | plugin |
| Stuck or failing Serverless jobs/endpoints | `nebius-serverless-troubleshooting` | plugin |
| Interactive GPU dev environments | `nebius-devlabs` | plugin |

**Hosting a model (our guidance, not Nebius's):**
- If Token Factory already serves the open model, call it: serverless, pay per token.
- If you need a fixed region, reserved capacity or your fine-tuned weights, use a Token Factory dedicated endpoint
  (billed per GPU-hour while a replica runs).
- If you need your own container or a model Token Factory doesn't offer, use AI Cloud Serverless endpoints. You run
  e.g. vLLM yourself and pay Compute VM and disk prices while it runs; nothing is billed while it's stopped
  ([Serverless pricing](https://docs.nebius.com/serverless/pricing-quotas)).

**`repo`** skills live in `.claude/skills/` and are ours to edit. **`plugin`** skills come from the `nebius-cloud` plugin
(marketplace `nebius/skills`, Apache-2.0), which `.claude/settings.json` enables for everyone. Claude Code lists them as
`nebius-cloud:<name>`. File paths in the "Where" columns below are relative to the plugin's `skills/` folder
(`~/.claude/plugins/marketplaces/nebius/skills/`). They were checked at commit `8707c2d` (2026-10-22). Don't edit or vendor
copies of them, because a plugin update overwrites them and copies show up as duplicate skills. **Where they disagree with this file, this file wins.**
Re-check after a plugin update, or if this file is more than a month old.

## Errors in the `nebius-cloud` plugin skills

_Checked 2026-10-24 against the official docs (https://docs.nebius.com, `llms-full.txt`) and the public protos in
`nebius/api`. Items without a finding were spot-checked and matched._

### Safety first (applies to every plugin skill)

- ✔ **`nebius config get private-key` prints a service account's private key**
  ([CLI ref](https://docs.nebius.com/cli/reference/config/get)). 11 of the plugin's skills, including
  `nebius-cloud-basics` (`SKILL.md:13`), auto-approve `Bash(nebius config get:*)`, which also matches
  `config get private-key`. `nebius-cloud-basics/references/safety-tiers.md:7` lists `config get/list` as free reads.
  This repo **denies** `nebius config get private-key` in `.claude/settings.json`. Never run it some other way, and
  don't dump `config list` into the transcript.
- The shared preamble says secrets live in `~/.nebius/credentials.json`. **No such fixed file exists.** Inline keys are
  in **`~/.nebius/config.yaml`**, and service-account JSON goes wherever `--output` pointed. Don't `cat` either, even
  though some doc pages suggest `cat ~/.nebius/config.yaml` to find a project ID; use `nebius config get parent-id`.
- `compute instance get --format yaml` can print `cloud_init_user_data`, which may hold secrets. Select fields with jq
  instead of dumping specs (same rule as `.spec.auth_token` on endpoints).

### CLI basics, compute, capacity, billing

Seven skills checked (about 150 claims): 15 wrong, 4 outdated. `nebius-public-docs` had **no errors**, and
`nebius-api-debug`'s JS SDK guidance is accurate.

| Skill says | Correct | Where in skill |
| --- | --- | --- |
| `capacity-interval list --parent-id "$TENANT"`; intervals are "tenant-scoped" | ✔ `--parent-id` is a **Capacity Block Group ID** ([CLI ref](https://docs.nebius.com/cli/reference/capacity/capacity-interval/list)). Get one from `capacity capacity-block-group list --parent-id <tenant>` | `nebius-capacity-quotas/SKILL.md:137`, `shared/preamble.md:28` (in every skill), `nebius-cloud-basics/SKILL.md:95` |
| "Quota increases are `quota-allowance create`/`update`" | `quota-allowance create` sets **a project's share** of existing quota. Getting more from Nebius is a **Change quota request** in the console, and needs `admin` ([quotas](https://docs.nebius.com/overview/quotas)). It's outward-facing, so ask first | `nebius-capacity-quotas/SKILL.md:155` |
| `us-central1-b` is a capacity region | It's an **InfiniBand fabric** (B200, region `us-central1`). Filter on `.spec.fabric`, not `.spec.region` | `nebius-capacity-quotas/SKILL.md:3, 104-112` |
| Spot bid window read straight from `calculator estimate` | ✔ The calculator prices the **whole preset**. **Divide by the preset's GPU count** to get the per-GPU bid ([pricing policies](https://docs.nebius.com/signup-billing/manage-pricing-policy)). Otherwise an 8-GPU preset bids 8× too high | `nebius-billing/SKILL.md:117-127, 142, 161` |
| A universal $0.79/GPU-hour spot floor | $0.79 for H200, H100 and RTX PRO 6000, but **$0.99 for B200 and B300** ([Compute pricing](https://docs.nebius.com/compute/resources/pricing)) | `nebius-billing/SKILL.md:142, 161` |
| Policy fields `spec.compute_instance.platform`, `spec.pricing.max_price_v1` | `spec.compute_instance_spec.v1.platform` and `spec.pricing.max_price_v1.max_price` (`billing/v1/pricing_policy.proto`) | `nebius-billing/SKILL.md:138` |
| `estimate-batch` returns `resource_costs[]` + `total_costs[]` with `sku_costs[]` | That's the `billing.v1` API, which has no CLI command. `billing v1alpha1 calculator estimate-batch` returns only aggregated `hourly_cost`/`monthly_cost` | `nebius-billing/SKILL.md:110` |
| Live spot price only via the calculator | Use `nebius billing v1alpha1 spot-price list --all` (and `list-series` for history) ([spot prices](https://docs.nebius.com/signup-billing/spot-prices)) | `nebius-billing` (gap) |
| `compute instance create --preemptible` | Compute has **no `--preemptible`**. It's `--preemptible-on-preemption stop` plus `--follows-spot-price` or `--spot-pricing-policy-id`, plus `--recovery-policy fail`. (`--preemptible` is right for `ai job/endpoint create`) | `nebius-billing/SKILL.md:172` |
| Preemptible VM template: uncomment `preemptible: {on_preemption: stop}` | Also set **`recovery_policy: fail`** (the default `RECOVER` errors on preemptible VMs) and a spot pricing model (`follows_spot_price: {}` or `spot_pricing_policy: {id}`). Preemptible is GPU platforms only, but the template defaults to `cpu-d3` ([preemptible](https://docs.nebius.com/compute/virtual-machines/preemptible)) | `nebius-compute-provision/assets/instance-template.yaml:48-51` |
| InfiniBand fabric names come from the account manager | They're published: `fabric-2/3/4/6` (H100, eu-north1), `fabric-5` (H200, eu-west1), `fabric-7` (H200, eu-north1), `us-central1-a` (H200), `us-central1-b` (B200), `uk-south1-a`, `eu-west2-a` and `us-north1-a` (B300), `me-west1-a` (B200-a) ([GPU clusters](https://docs.nebius.com/compute/clusters/gpu#infiniband-fabrics)) | `nebius-compute-provision/assets/gpu-cluster-template.yaml:10-11` |
| `update -f` needs a full spec | `update --patch --file <partial.yaml>` works, plus `--diff` to preview. That's safer than rebuilding the whole spec ([update](https://docs.nebius.com/cli/update)) | `nebius-compute-provision/SKILL.md:118` |
| Image family "e.g. `ubuntu`" | Families are versioned: `ubuntu24.04-driverless`, `ubuntu24.04-cuda12`, `ubuntu24.04-cuda13.0`, …; `ubuntu22.04-*` are deprecated ([images](https://docs.nebius.com/compute/storage/boot-disk-images)) | `nebius-compute-inventory/references/resources.md:11` |
| Disk size jq `.spec.size_gibibytes // .spec.size_bytes` | Size is a oneof that also includes `size_kibibytes`/`size_mebibytes` | `nebius-compute-inventory/SKILL.md:120` |
| `--jsonpath <expr>` | `--format jsonpath='<expr>'` ([jsonpath](https://docs.nebius.com/cli/jsonpath-output)) | `nebius-cloud-basics/references/output-and-paging.md:9` |
| Calculator disk type `network_ssd_io_m`; filesystem types `network_ssd \| network_hdd` | `network_ssd_io_m3`; filesystems also `weka`, `vast` | `nebius-billing/SKILL.md:87, 93` |

Unverifiable (not in the docs, CLI reference or protos): the `AI_AGENT` env var, "Trace ID" in CLI errors, and
`TF_LOG_PROVIDER_NEBIUS`. Prices are in ILS for Israeli companies, otherwise USD.

### Related Nebius tools (assessed, not installed)

- **Docs MCP `https://docs.nebius.com/mcp`**: official, read-only, no key. Two tools,
  `search_nebius_ai_cloud` and `query_docs_filesystem_nebius_ai_cloud`. AI Cloud docs only, not Token Factory.
  `nebius-public-docs` uses it if present. To add it: `{"mcpServers": {"nebius-docs": {"url": "https://docs.nebius.com/mcp"}}}`.
  Not added to this repo yet (ask the team first).
- **`nebius/mcp-server`** (beta, Python 3.13): runs arbitrary `nebius` CLI commands. Its "safe mode" blocks only
  update/delete words, so create/start/stop, access-key creation and `config get private-key` still go through,
  and it installs unpinned from `main`. **Don't use** it, under this repo's ask-first rule (below).
- **`nebius/nebius-ps-services` → `nebius` skill**: professional-services monorepo, Python-first, depends on
  sibling skills, ships credential scripts. Not needed for a one-day hackathon build.
- `arindam200/nebius-skills` isn't from Nebius.

### Serverless AI and Devlabs

Seven skills checked (about 150 claims): 14 wrong, 5 outdated. ✔ = re-checked directly against the docs page.

| Skill says | Correct | Where in skill |
| --- | --- | --- |
| `assets/job-create.sh` / `assets/endpoint-create.sh` are create "skeletons" ending in `--dry-run` | ✔ **Broken bash, and it's not a dry run.** A `\` followed by `# comment` ends the command, so line 7 runs a **real `create` without `--dry-run`** and every later line errors. Never run or paste them. Build the command yourself with no inline comments, and keep `--dry-run` until the user confirms | `nebius-serverless-jobs/assets/job-create.sh:6-12`, `nebius-serverless-endpoints/assets/endpoint-create.sh:6-14` |
| `--restart-policy on-failure --restart-attempts -1` | ✔ **There is no `--restart-attempts` CLI flag.** Use `--restart-policy on-failure`; `restart_attempts: -1` is the SDK/REST field it maps to ([auto-restarts](https://docs.nebius.com/serverless/jobs/auto-restarts)) | `nebius-serverless-recipes/SKILL.md:179, 196` |
| `on-failure` restarts make preemptible jobs resume | ✔ Restarts react **only to the container's exit code**. Preemption, no capacity, VM loss, startup failures and timeouts put the job in **`ERROR`**, with no restart. Checkpoint, then `nebius ai job restart` or resubmit | `nebius-serverless-jobs/SKILL.md:93`, `nebius-serverless-recipes/SKILL.md:189-202` |
| Poll until `COMPLETED\|FAILED\|CANCELLED` | Jobs also end in **`ERROR`**, so the loop never exits. Add `ERROR` and a maximum number of iterations | `nebius-serverless-recipes/SKILL.md:104` |
| States `PROVISIONING → STARTING → RUNNING`; a stuck start "sits there billing" | ✔ There's also **`IMAGE_PULLING`** (`PROVISIONING → STARTING → IMAGE_PULLING → RUNNING`). Read **`status.state_details.code`** first (`StartFailed`, `ContainerFailed`, `TimeoutExceeded`, `NotEnoughResources`, …). Start time isn't billed. With no capacity it retries for 30 min, then `ERROR`/`NotEnoughResources`, with no retry ([lifecycle](https://docs.nebius.com/serverless/lifecycle)) | `nebius-serverless-jobs/SKILL.md:136-143`, `nebius-serverless-troubleshooting/SKILL.md:85-88, 110` |
| Endpoints bill "from create to delete, including `STARTING`" | ✔ Billed **while running** at Compute VM/disk prices. Not billed while stopped, except mounted buckets and filesystems ([pricing](https://docs.nebius.com/serverless/pricing-quotas)). A running idle endpoint still bills | `nebius-serverless-endpoints/SKILL.md:24, 81` |
| Forgotten 1×H100 endpoint ≈ $90+/day | ✔ H100 is **$4.50/GPU-hour since 2026-10-01** (was $3.85), so ≈ $108/day plus disk. Only in `eu-north1` ([Compute pricing](https://docs.nebius.com/compute/resources/pricing)) | `nebius-serverless-endpoints/SKILL.md:81` |
| Smoke test uses `.status.public_endpoints[0]` | ✔ That list can hold `tls://` or `IP:port` entries. Select the HTTPS one: `jq -r '.status.public_endpoints[] \| select(startswith("https://"))' \| head -1` ([endpoints](https://docs.nebius.com/serverless/endpoints/manage)) | `nebius-serverless-endpoints/SKILL.md:149-151` |
| No endpoint update: create new, then delete old | Also: push a new image **to the same tag**, then `nebius ai endpoint restart`. That keeps the URL and IP (only if the endpoint uses a tag, not a digest) | `nebius-serverless-endpoints/SKILL.md:160` |
| A multi-word `bash -c "…"` can't go through `--args` | `--args` is quote-aware. The docs pass `--args '-c "…"'` and `--args "-lc '<cmd> \|\| (echo FAILED; sleep 86400)'"` | `nebius-serverless-jobs/SKILL.md:107-110` |
| S3 volumes with AWS profile keys are "the main data path" | **Nebius** buckets and filesystems mount by **ID or name, with no credentials**: `--volume '<bucket-id>:/data:rw'`. Use `s3://` only for external S3. A plain AWS `PROFILE` copies the keys **inline into the spec**; use `PROFILE@SECRET_SELECTOR` | `nebius-serverless-data-secrets/SKILL.md:73-81` |
| `--env-secret KEY=SELECTOR` | `KEY` must equal a **payload key** in the secret (otherwise the first entry is used silently), and it can't also be in `--env`. Secrets are **region-scoped** | `nebius-serverless-data-secrets/SKILL.md:94`, `nebius-serverless-recipes/SKILL.md:138` |
| "MysteryBox" | ✔ It's now called **SecretStash**. CLI/API/Terraform still use the `mysterybox` identifier ([SecretStash](https://docs.nebius.com/mysterybox)) | `nebius-serverless-data-secrets/SKILL.md:92-96` |
| GitHub Actions: `printf '%s' "${{ secrets.NEBIUS_SA_CREDENTIALS }}" > creds.json` | Produces **invalid JSON**, and it's a script-injection pattern. Pass the secret via `env:` and `printf '%s' "$NEBIUS_CREDENTIALS"`. Also **install the CLI** and run `nebius iam get-access-token \| docker login cr.<region>.nebius.cloud --username iam --password-stdin` before pushing ([no-browser](https://docs.nebius.com/cli/no-browser)) | `nebius-serverless-recipes/SKILL.md:208-237` |
| Platform table: `gpu-gb300`, region "KCS", no B200/B300, H100/L40S with no region | No `gpu-gb300` and no region "KCS". `gpu-b300-sxm` (uk-south1, eu-west2, us-north1), `gpu-b200-sxm` (us-central1), `gpu-rtx6000` (us-central1) / `gpu-rtx6000-a` (uk-south2, eu-south1). `gpu-h100-sxm`, `gpu-l40s-*` and `cpu-e2` are **eu-north1 only** ([types](https://docs.nebius.com/compute/virtual-machines/types)) | `nebius-serverless-jobs/references/platform-presets.md:18-26` |
| Grant "only the Serverless roles" (example uses `storage.editor`) | There are **no Serverless-specific roles**; creating jobs, endpoints or Devlabs needs **`editor`**. For least privilege, use a **project-scoped** custom group with `--role editor` | `nebius-serverless-setup/SKILL.md:91`, `references/iam-grants.md` |
| `nebius profile create ci --service-account-file-path …` | That **switches your active profile** to the CI service account. Run it in CI, or switch back afterwards. `NEBIUS_IAM_TOKEN` is documented for Terraform, not the CLI | `nebius-serverless-setup/SKILL.md:104-106` |
| `ai job ssh` / `ai endpoint ssh` for live debugging | Only works if the workload was created with `--ssh-key`. A failed job's VM is deleted, so wrap the command: `bash -lc '<cmd> \|\| (echo FAILED; sleep 86400)'` ([failure](https://docs.nebius.com/serverless/jobs/failure)) | `nebius-serverless-troubleshooting/SKILL.md:121` |
| Devlab templates: "inspect inputs" | JupyterLab **requires** `--input jupyter_token=<exactly 16 alphanumerics>`. Treat it as a secret. Without token auth, **anyone with the URL** gets in | `nebius-devlabs/SKILL.md:99` |

`nebius-serverless-recipes`: **use for reference only.** Recipes 1, 5, 6 and 7 fail or hang as written; the fixes are
above. `nebius-devlabs` is the most accurate of the seven, and its `assets/devlab-create.sh` is valid bash.
Several docs pages contradict each other (registry-secret key case, Devlab S3 mounts, SSH/public IP). Follow the
CLI reference and check with `--dry-run`. The full report with every verified claim isn't in this repo; this table keeps the parts that change what an agent does.

## Errors in the official Token Factory docs (our skills already work around them)

| Docs say | Correct | Where |
| --- | --- | --- |
| Examples use `moonshotai/Kimi-K2.5`, Llama 3.1, `Qwen/Qwen2-VL-72B-Instruct`, `stability-ai/sdxl` | Kimi-K2.5 was retired 2026-06-22, and several others are gone or going. Take IDs from `GET /v1/models?verbose=true` | [switch](https://docs.tokenfactory.nebius.com/switch), API examples |
| JSON-schema Python example; cURL `"response format"` | Python is a syntax error and omits `name`/`schema`; the cURL field has a space, so it's ignored. Use `{type: "json_schema", json_schema: {name, schema, strict}}` | [JSON](https://docs.tokenfactory.nebius.com/ai-models-inference/json) |
| "Use Batch API for async workloads" | There's no `/v1/batches` in the OpenAPI spec. Batch runs as a Data Lab operation (`POST /v1/operations`, `type: batch_inference`), with output in a destination dataset | [rate limits](https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits) |
| Fine-tune polling loop `while job.status in ACTIVE_STATUSES` | That list holds the **terminal** statuses, so the loop exits at once. Loop while the status is not terminal | [fine-tune](https://docs.tokenfactory.nebius.com/post-training/how-to-fine-tune) |
| Create dedicated endpoint returns `endpoint_id` | The spec returns 201 `{endpoint: {id, routing_key, …}}` | [deploy via API](https://docs.tokenfactory.nebius.com/ai-models-inference/dedicated-endpoints/deploy-api) |
| Code-autocomplete cURL `-H "Authorization: $NEBIUS_API_KEY"`; the JS example calls `openai.completions` | Needs `Bearer `; the client is `client` | [autocomplete](https://docs.tokenfactory.nebius.com/api-reference/examples/text-generation-for-code-autocomplete) |
| `/v1/images/generations` example | Not in the OpenAPI spec, and its example models look retired. Confirm with a live key before relying on it | [image generation](https://docs.tokenfactory.nebius.com/api-reference/examples/image-generation) |

More doc-vs-spec conflicts: `nebius-token-factory-custom-models` → `references/api.md` (21 of them), and the
"Doc conflicts" table in `nebius-sandboxes`.

## Rules for Nebius in this repo

- **Keys stay server-side.** `NEBIUS_API_KEY` (Token Factory) goes in the root `.env`, which is gitignored; `.env.example` holds the
  placeholder. Never put it in a browser-bundled variable (`VITE_*`, `NEXT_PUBLIC_*`), front-end code, logs, commits or
  chat. AI Cloud service-account keys and `~/.nebius` profiles never go in the repo.
- **Default to per-token serverless inference.** For a one-day build that covers almost everything. **Ask the human first
  before anything that costs money by the hour or is outward-facing**: dedicated endpoints, fine-tune jobs, Serverless
  jobs/endpoints, VMs, quota requests. If you start one, put it and the command that stops it in your `HANDOFF.md` lane,
  so nothing is left billing after judging. A stopped dedicated endpoint gives up its GPUs, and getting capacity back can take a while.
- **Data:** Token Factory stores prompts and outputs by default (in Finland, for speculative decoding). Use synthetic or
  public data for the demo. Before sending real personal data, turn on Zero Data Retention (an org setting for Admins) or log a
  decision with `/decision`.
- **Failures are demo material.** When a Nebius model or API misbehaves, log it in `docs/MODEL_FAILURES.md` (`/log-failure`).
- Status (2026-10-24): no app code yet, and nothing in these skills has been tested against a live key. When a live
  call confirms or contradicts something here, fix this file.
