---
name: nebius-sandboxes
description: Nebius Token Factory Sandboxes (ConTree): VM-isolated cloud containers that run untrusted or agent-generated code, with immutable image checkpoints and git-like branches. Use for sandbox, code execution for agents, run untrusted code, ConTree / contree-sdk / contree-cli / contree-mcp, checkpoints, branches, rollback, SWE-bench environments. Not for Token Factory inference or fine-tuning.
---

# Nebius Sandboxes (ConTree)

**Snapshot as of 2026-10-24**, from the official docs (https://docs.tokenfactory.nebius.com/sandboxes/overview)
and the OpenAPI spec they render (https://eu-north.nebius.computer/static/api.yaml). The product is in **Beta**;
access is by request at https://tokenfactory.nebius.com/sandboxes/about. Re-check anything here that is more than a
month old. Inference and fine-tuning live in their own skills.

**ConTree is the same product.** The Token Factory pages call it "Sandboxes", while the SDK, CLI and MCP pages call it
ConTree/Contree. The packages are `contree-sdk`, `contree-cli` and `contree-mcp`, feedback goes to `contree@nebius.com`,
and an older JWT-only deployment lives at `contree.dev`
([overview](https://docs.tokenfactory.nebius.com/sandboxes/overview),
[MCP config](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/configuration)).

**There is no JS/TS SDK.** As of 2026-10-24 all three `nebius/contree-*` repos (and `contree-client`) are Python, and
npm has no `contree-sdk`. From a TypeScript/Node server, call the **REST API** with `fetch`.

Details load on demand: [python-sdk](references/python-sdk.md) · [cli](references/cli.md) · [mcp](references/mcp.md) ·
[rest-api](references/rest-api.md) · [recipes](references/recipes.md).

## Mental model

| Thing | What it is | Survives the run? |
| --- | --- | --- |
| **Image** | Immutable filesystem snapshot, identified by UUID. Public images plus your project's own. | Yes, until retention removes it (180 days) |
| **Tag** | A mutable name that points to an image (`tag:ubuntu:latest`). Moving it changes what it resolves to. | Pointer only |
| **Operation** | One run: a fresh microVM from an image runs your command as the primary process (`spid=1`) | Output and result, subject to caps |
| **Checkpoint** | An image you chose to continue from. It only exists if the run was **not disposable** and returned a result UUID | Yes |
| **Branch** | Independent operations started from the same image UUID. **There is no merge.** | Each saves its own image |
| **Session** | Client-side bookkeeping only (CLI SQLite database, SDK session object). **It never keeps a VM alive.** | Local |
| **Subprocess** | Extra process inside a *running* operation (REST only). It shares the VM and dies when `spid=1` ends | No own image |

Sources: [execution lifecycle](https://docs.tokenfactory.nebius.com/sandboxes/concepts/execution-lifecycle),
[images/checkpoints/branches](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches),
[sessions](https://docs.tokenfactory.nebius.com/sandboxes/concepts/sessions-and-execution-modes).

A saved image keeps **files only**. Processes, memory, open handles, network connections and services do not carry over,
so restart any server in the next operation. Operation states are `PENDING` → `ASSIGNED` → `EXECUTING` → `SUCCESS` |
`FAILED` | `CANCELLED`. **`SUCCESS` only means the service finished.** Check `exit_code`, `signal` and `timed_out`
separately ([lifecycle](https://docs.tokenfactory.nebius.com/sandboxes/concepts/execution-lifecycle)).

## Defaults differ by interface (set them explicitly every time)

| | Python SDK 0.3.6 | REST | CLI 0.9.4 | MCP `run` |
| --- | --- | --- | --- | --- |
| Save filesystem changes | `disposable=True` (**discards**) | `disposable: false` (**saves**) | saves; `-D` discards | `disposable=true` (discards) |
| Timeout (s) | not documented ¹ | no default in spec | `-t` 120 | `30` |
| Recorded output cap per stream | guide says 1 MiB; source says 65535 ¹ | 1 MiB (max 10 MiB) | `-T` 65536 | `8000` bytes |
| Shell vs exec | `shell=` or `command=`+`args=` | `shell` defaults to `false` | direct; `-s` for shell | `shell` defaults to `true` |
| Disable network | **not exposed** | `networking.enabled=false` | **not exposed** | **not exposed** |

Sources: [defaults table](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches),
[`contree run`](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/run),
[MCP run](https://docs.tokenfactory.nebius.com/sandboxes/mcp/tools/run),
[limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage), spec `InstanceSpawnRequest`.
¹ Checked in the `contree-sdk` 0.3.6 source on GitHub, not in the docs: an unset timeout becomes 1000 s
(`operation_timeout`) and an unset cap becomes 65535 bytes (`default_truncate_output_at`). That contradicts the
[files guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/work-with-files-and-artifacts)'s "1 MiB default".
Pass both values explicitly.

## Choose an interface

| Need | Use | Why |
| --- | --- | --- |
| Python app or agent | SDK `contree-sdk==0.3.6` | Image objects, async/sync, files ([choose](https://docs.tokenfactory.nebius.com/sandboxes/start/choose-an-interface)) |
| **TypeScript/Node**, live events, or subprocess control | REST | Only REST has SSE resume (`Last-Event-Id`) and the subprocess/stdin/signal endpoints |
| Shell exploration or scripts | CLI `contree-cli==0.9.4` | Profiles, sessions, branches, rollback, `ls`/`cat` without a VM |
| Coding agent in Claude Code or Cursor | MCP `contree-mcp` | `run`, `rsync`, `list_files`… Check the tool list your server actually exposes |

Inspecting files in a stored image (`ls`/`read`/`download`, `/inspect/*`, `list_files`/`read_file`) needs **no VM**.

## Auth

1. Create an API key at https://tokenfactory.nebius.com/project/api-keys in the project that will run Sandboxes. It is
   shown once. Copy the **project ID** from Project settings
   ([set up access](https://docs.tokenfactory.nebius.com/sandboxes/start/set-up-access)).
2. Every request sends `Authorization: Bearer <key>` plus `Project: <project-id>`. Base URL:
   `https://api.tokenfactory.nebius.com/sandboxes/v1` ([reference map](https://docs.tokenfactory.nebius.com/sandboxes/reference/index)).
3. **The project variable name depends on the tool:**

| Surface | Key | Project | Notes |
| --- | --- | --- | --- |
| Python SDK 0.3.6 | `NEBIUS_API_KEY` | `NEBIUS_PROJECT_ID` | Read when the client is created |
| REST examples | `NEBIUS_API_KEY` | `NEBIUS_PROJECT_ID` | Docs also use `CONTREE_BASE_URL` for the base URL |
| CLI `contree auth` | `CONTREE_TOKEN` › `NEBIUS_API_KEY` | `CONTREE_PROJECT` › `NEBIUS_AI_PROJECT` | Read **only at registration**; later commands use `~/.config/contree/auth.ini` |
| MCP server | flags › `CONTREE_*` › `NEBIUS_API_KEY`+`NEBIUS_AI_PROJECT` (**both** or ignored) › `auth.ini` | | Run `contree auth` once and the server picks up the same profile |

Sources: [set up access](https://docs.tokenfactory.nebius.com/sandboxes/start/set-up-access),
[CLI install](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/installation),
[MCP config](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/configuration).
`contree auth ls` status: `ok`; `inactive` (key accepted, but Sandboxes isn't activated or you lack permission; mail
the project ID to `contree@nebius.com`); `timeout` (2 s probe); `error`. **In this repo:** keep the key in
the root `.env` (gitignored), never in a browser-bundled variable (`VITE_*`, `NEXT_PUBLIC_*`), and never pass it into guest code.

## Minimal example

**Python** ([quickstart](https://docs.tokenfactory.nebius.com/sandboxes/start/python-quickstart); `uv add "contree-sdk==0.3.6"`, Python 3.12):

```python
import asyncio
from contree_sdk import Contree

async def main() -> None:
    client = Contree()                       # SDK 0.3.6 reads NEBIUS_API_KEY + NEBIUS_PROJECT_ID
    base = await client.images.use("alpine:3.19", strict=True)
    checkpoint = await base.run(shell="printf 'ready\\n' > /tmp/status.txt", disposable=False)
    if checkpoint.exit_code != 0 or checkpoint.uuid is None:
        raise RuntimeError(checkpoint.stderr)
    result = await checkpoint.run(shell="cat /tmp/status.txt", disposable=True)
    print(checkpoint.uuid, result.stdout, end="")   # result.uuid is None (disposable)

asyncio.run(main())
```

`base.run(...)` only *prepares* the run. **Awaiting it submits the work and waits**; the sync client uses
`.run(...).wait()`.

**CLI** ([quickstart](https://docs.tokenfactory.nebius.com/sandboxes/start/cli-quickstart)):

```bash
uv tool install "contree-cli==0.9.4"
export NEBIUS_API_KEY=... NEBIUS_AI_PROJECT=...   # CLI uses NEBIUS_AI_PROJECT
contree auth -y && contree auth ls                # expect status ok
export CONTREE_SESSION="quickstart-$USER-$$"
contree use tag:ubuntu:latest
contree run -- sh -c 'printf "ready\n" > /tmp/quickstart.txt'   # no -D: saves + advances session
contree run -D -- cat /tmp/quickstart.txt                        # -D: discard
```

**REST** (the body comes from [run commands](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-commands-and-results)
and the curl style from [limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage)):

```bash
B=https://api.tokenfactory.nebius.com/sandboxes
H=(-H "Authorization: Bearer $NEBIUS_API_KEY" -H "Project: $NEBIUS_PROJECT_ID")
OP=$(curl -sS --fail-with-body "${H[@]}" -H 'Content-Type: application/json' -X POST "$B/v1/instances" \
  -d "{\"image\":\"$IMAGE_UUID\",\"command\":\"/bin/echo\",\"args\":[\"ready\"],\"shell\":false,\"disposable\":true,\"timeout\":30}" | jq -r .uuid)
curl -sS --fail-with-body "${H[@]}" "$B/v1/operations/$OP" |
  jq '{status, error, result_image_uuid, state: .metadata.result.state, out: .metadata.result.stdout}'
```

The POST returns `201` with the operation `uuid`. Poll until the status is terminal, honouring `Retry-After`, with a
deadline. `stdout`/`stderr` are `{value, encoding: ascii|base64, truncated}`, so decode base64. **Never blindly re-POST
after a transport error:** creates have no idempotency key, so the work may already be running
([concurrency](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-concurrent-workloads)).

## Networking & secrets

- **Networking is on by default.** `{"networking": {"enabled": false}}` on `POST /v1/instances` starts the VM with no
  guest network interface. Set it on every operation; a subprocess inherits its parent's VM. Allowlists, private
  networking, ingress, DNS controls and network logs are **not documented**, so ask the team first
  ([networking](https://docs.tokenfactory.nebius.com/sandboxes/guides/configure-networking-and-secrets)).
- The pattern is to fetch dependencies in a saved setup run, then verify from its UUID with networking off. A saved
  image carries files, not network policy.
- **Secrets:** keep the API key in the client. Never put credentials in args, stdout/stderr, uploaded files,
  Dockerfile `ARG`, retained paths, or `preserve_env=True` (which writes the merged env into **image metadata**). Pass
  short-lived, narrow credentials only to the runs that need them. `env` values are recorded in the operation's input
  metadata ([images & branches](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches)).
- `shell=true` inherits the image's `ENV`; `shell=false` gets **only** the `env` you pass (spec: `PATH` defaults to
  `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`).

## Limits, retention, pricing (as of 2026-10-24)

| Item | Value | Source |
| --- | --- | --- |
| Simultaneous operations | **50** during Beta. The real limit is in `GET /v1/whoami` → `limits`; ask to raise it | [limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage) |
| Checkpoint image retention | **180 days**, after which untagged, unreferenced images may be deleted | same |
| Recorded stdin/stdout/stderr | 1 MiB per stream by default, 10 MiB max (`truncate_output_at`) | same |
| Execution timeout | Request field in seconds; the account max is in token limits | same |
| Writable layer | `resources_limits.max_layer_bytes`, default 12884901888 (12 GiB) | spec |
| Import timeout | Default 300 s | spec `ImageImportRequest` |
| VM start | ~2–5 s per `run` | [MCP concepts](https://docs.tokenfactory.nebius.com/sandboxes/mcp/concepts/core) |
| Upload, download and total image size; start rate; region; event retention | **Not documented.** Ask `contree@nebius.com` | [limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage) |
| **Pricing** | **Not documented** in the Sandboxes docs. Each operation has a raw `cost` field, for diagnostics only; reconcile against billing records | same |

## Security notes

- Each run is VM-isolated (a microVM with its own kernel) and runs as **root** by default (`uid`/`gid` 0). The sandbox
  is the boundary, so control what data and credentials enter it
  ([security](https://docs.tokenfactory.nebius.com/sandboxes/operate/security-and-data-handling)).
- A disposable run is **not** a deletion guarantee: uploads, operation records and logs may persist. Encryption at
  rest, residency, deletion and retention per data surface are **not documented**, so confirm before processing
  sensitive data.
- The MCP `download` tool writes to any absolute path on the **MCP host**, creating parent directories. MCP HTTP mode
  documents no auth, so keep `--http-listen 127.0.0.1` (the default)
  ([MCP config](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/configuration)).
- `--token` on the CLI and `CONTREE_TOKEN` in the environment both show up in process listings. Use the `auth.ini`
  profile, which is created with mode `0600`.
- The spec says an import `tag` "identif[ies] the image when listing publicly available images", while the CLI
  tutorial says tags are project-scoped. **Who can see a tagged image is unclear**, so don't tag images that hold
  private data until that's confirmed (spec `ImageImportRequest`;
  [CLI images](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/images)).
- For support, send operation and image UUIDs, timestamps, client versions and **redacted** errors. Never send keys,
  headers, customer files or full logs.

## Gotchas (from [troubleshooting](https://docs.tokenfactory.nebius.com/sandboxes/operate/troubleshooting) unless noted)

- **Interrupted request:** check the operation ID before you resubmit, because accepted work may still be running. If
  no ID came back, resolve that uncertainty first.
- **401:** refresh the key or profile. **403:** check the `Project` header and the token's permissions; activation is
  not the only cause.
- **Image or tag not found:** resolve the tag again or use the recorded UUID. **Tags move**, so record UUIDs for
  anything reproducible.
- **No result image:** check `disposable`, the terminal status and `result_image_uuid`. A disposable result can't be a
  continuation point, and the SDK raises `DisposableImageRunError` if you try.
- **No output:** flush buffers, check stderr, check `truncated`. Write big or binary output to a file in a saved
  image and download it.
- **A nonzero exit is a workload result.** `timed_out` and signals are a separate class; retry from known state.
- **Stream ended ≠ execution ended.** Resume from the last *fully processed* event ID, then query the final status.
- **Stdin write timed out (504):** delivery is unknown, so reconcile with sequence numbers and don't replay blindly.
- **Child missing:** the parent finalized. A child can't outlive `spid=1`; start a new operation.
- **Rate or service rejection:** back off as the response says. An undocumented 503 doesn't prove a capacity problem.
- **Network unavailable:** check the spawn `networking` field and the guest interfaces.
- **SDK 0.3.6 wait timeout:** the SDK attempts best-effort cancellation. Resolve the real outcome before you repeat.
- **Image expiry:** rebuild from pinned inputs; the stored filesystem is gone.
- `contree op wait --all`, `kill --all` and `op cancel --all` are **project-wide**. Cancel only the IDs your batch
  owns ([operation](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/operation)).
- OCI import keeps the rootfs and `ENV` only. `CMD`, `ENTRYPOINT`, `WORKDIR`, ports and healthchecks are dropped, so
  name the command at run time (spec, [prepare](https://docs.tokenfactory.nebius.com/sandboxes/guides/prepare-and-reuse-environments)).
- `DELETE …/subprocesses/{spid}` with no `signal` sends **SIGKILL** (spec). Signalling `spid=1` ends the operation.
- The Mini-SWE-Agent `ContreeEnvironment` adapter is **broken** with the current SDK: its example raises
  `RuntimeError` ([cookbook](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/index)).
- More than 7,000 SWE environments are preloaded (SWE-bench Verified, SWE-rebench, SWE-rebench-V2). **How they are
  named or tagged is not documented** ([SWE agents](https://docs.tokenfactory.nebius.com/sandboxes/swe-agents)).

## Doc conflicts (as of 2026-10-24)

| Conflict | Pages | Resolution used here |
| --- | --- | --- |
| `Contree()` with no args reads env vars, **vs** `Contree(client)` requiring a `contree_client` client (*"contree_sdk performs no auth"*) | [quickstart](https://docs.tokenfactory.nebius.com/sandboxes/start/python-quickstart) vs [getting started](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/getting-started), [client ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/client) | GitHub: 0.3.6 (latest stable on PyPI) has `Contree(config=None, *, base_url, token)`; the explicit-client pages match the `0.4.0.dev*` line. Pin 0.3.6 and follow the guides |
| The SDK reference lists `start()` and `iter_output()`; the interface page says 0.3.6 has no event-stream method or detached start | [image ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/image) vs [choose](https://docs.tokenfactory.nebius.com/sandboxes/start/choose-an-interface) | The 0.3.6 source has neither; treat them as dev-only |
| Session `run()` defaults to `disposable=False` **vs** `True` | [running commands](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/running-commands) vs [session ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/session), [concepts](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches) | Assume `True`; always pass it |
| MCP has "15 tools" **vs** "All 18 tools"; troubleshooting cites a `whoami` tool that isn't listed; the GitHub README uses `contree_`-prefixed names | [MCP overview](https://docs.tokenfactory.nebius.com/sandboxes/mcp/index), [tools](https://docs.tokenfactory.nebius.com/sandboxes/mcp/tools/index), [MCP troubleshooting](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/troubleshooting) | Check the connected server's tool list |
| `directory_state_id` is an integer (`42`) **vs** a string (`"ds-…"`) | [rsync](https://docs.tokenfactory.nebius.com/sandboxes/mcp/tools/rsync) vs [MCP quickstart](https://docs.tokenfactory.nebius.com/sandboxes/mcp/quickstart) | Pass back exactly what `rsync` returned |
| The CLI has no event-stream command **vs** `contree op events` ("full raw event log") | [choose](https://docs.tokenfactory.nebius.com/sandboxes/start/choose-an-interface) vs [operation](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/operation) | Use REST SSE for live or resumable streams |
| `contree build`: multi-stage "parsed but not executed" **vs** the `--help` text "multistage supported" | [build](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/build) (same page) | Assume single-stage on 0.9.4 |
| CLI profile `type` defaults to `jwt` **vs** `iam` | [configuration](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration) vs [auth](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/auth) | Always write `type = iam` |
| Session DB at `sessions-{profile}.db` **vs** `cli/sessions/{profile}.db` | [configuration](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration), [sessions](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/sessions) | Don't rely on the path |
| Cancelled runs "may" return an image **vs** spec: `result_image_uuid` only on `SUCCESS` | [concepts](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches) vs spec `OperationResponse` | Treat non-`SUCCESS` as "no image" unless one is present |
| Guest file paths: "use absolute paths" **vs** examples with relative keys (`"data.txt"`) | [files guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/work-with-files-and-artifacts) vs [running commands](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/running-commands) | Use absolute paths (the spec says absolute) |
| Access via "Early Access form at contree.dev" **vs** Beta request on Token Factory | [MCP quickstart](https://docs.tokenfactory.nebius.com/sandboxes/mcp/quickstart) vs [overview](https://docs.tokenfactory.nebius.com/sandboxes/overview) | Use Token Factory IAM; contree.dev is the legacy JWT deployment |
| MCP: "full network/filesystem isolation" **vs** networking on by default | [MCP concepts](https://docs.tokenfactory.nebius.com/sandboxes/mcp/concepts/core) vs [limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage) | Assume guests can reach the internet |
