# REST API reference

Snapshot as of 2026-10-24. The endpoint pages under https://docs.tokenfactory.nebius.com/api-reference/sandboxes/ are
rendered from the OpenAPI spec at **https://eu-north.nebius.computer/static/api.yaml** ("Contree API" 1.0.0). Field
names and defaults below come from that spec ("spec"); behaviour comes from the guides. **This is the interface to
use from TypeScript, since there is no JS SDK.**

## Basics

| | |
| --- | --- |
| Base URL | `https://api.tokenfactory.nebius.com/sandboxes/v1`. The spec's server is `{baseUrl}/v1` with that default ([reference map](https://docs.tokenfactory.nebius.com/sandboxes/reference/index)) |
| Headers | `Authorization: Bearer $NEBIUS_API_KEY` **and** `Project: $NEBIUS_PROJECT_ID` (spec `IAMBearerAuth` + `IAMProjectHeader`) |
| Permissions | Named in `GET /whoami` → `permissions`, e.g. `import`, `spawn`, `spawn_disposable`, `list`, `cancel`, `set_image_tag` |
| Idempotency | **None** on create requests. Correlate with your own item IDs and never blind-retry a POST ([concurrency](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-concurrent-workloads)) |
| Image refs | A UUID, or `tag:NAME` (pattern `^tag:[A-Za-z0-9][A-Za-z0-9_-]*(?:[:/.][A-Za-z0-9_-]+)*$`). A tag is resolved to a UUID when the operation is created |

## Endpoints

| Method & path | Purpose | Notes |
| --- | --- | --- |
| `GET /whoami` | Token info | `token_uuid`, `token_expiration`, `permissions`, `limits` (e.g. `instance_max_timeout`, `instance_max_concurrency`), and `operations_stat`, which is reserved |
| `POST /instances` | **Start an operation** (new VM) | `201`: body echoes the request plus `uuid` (the operation ID); `Location: /v1/operations/{id}` |
| `GET /operations` | List | `limit` (100, 1–1000), `offset`, `status`, `kind` (`image_import` \| `instance`), `since`, `until` |
| `GET /operations/{id}` | Status and result | `?inflight=1` builds partial stdout/stderr for an `EXECUTING` instance, at extra cost |
| `DELETE /operations/{id}` | Cancel | `202` accepted; `409` conflict |
| `GET /operations/{id}/events` | SSE event log | `follow=0` (default, dump then close) or `1` (follow, needs `SPAWN`/`SPAWN_DISPOSABLE`), `spid`, `since`, header `Last-Event-Id` |
| `POST /operations/{id}/subprocesses` | Add a process to a **running** op | Body is an `ExecSpec`. `201 {spid ≥ 2}` + `Location`; `409` (not `ASSIGNED`/`EXECUTING`); `425` (retry after `Retry-After`); `504` (**may have started**, so check events for `spawn` first) |
| `GET /operations/{id}/subprocesses/{spid}` | Child result built from events | Same shape as `metadata.result`. While running, `exit_code` and `signal` are `-1`; `425` means not ready yet |
| `DELETE /operations/{id}/subprocesses/{spid}?signal=` | Signal the process group | **SIGKILL by default**; `signal` takes `15`, `TERM` or `SIGTERM`. `204` returned. `spid=1` ends the op |
| `POST /operations/{id}/subprocesses/{spid}/stdin` | Write stdin | `{value, encoding: ascii\|base64, close (default **true**)}`; `204`. `409` stdin closed or not running; `410` finished; `501` guest too old; `504` **delivery unknown** |
| `POST /images/import` | Import an OCI image (async op) | `{registry: {url, credentials?: {username, password}}, tag?, timeout (300)}` |
| `GET /images` | List images | `limit` (100, 1–1000), `offset`, `tagged`, `tag`, `uuid` |
| `PATCH /images/{uuid}/tag` | Set a tag | `{tag}`. A tag is unique per namespace, so setting it moves it |
| `DELETE /images/{uuid}/tag?tag=` | Remove one tag, or all | A public tag of the same name starts tracking the public image again |
| `POST /files` | Upload content | `application/octet-stream` body → `{uuid, sha256, size}` |
| `GET /files`, `GET`/`HEAD /files/{sha256}` | List uploads; look one up by hash | `HEAD` returns 200 or 404 for this namespace |
| `GET /inspect/{uuid}/` | Image metadata | `GET /inspect/?tag=` redirects to it |
| `GET /inspect/{uuid}/list?path=` | List a directory | `text` returns plain text instead of JSON |
| `GET`/`HEAD /inspect/{uuid}/download?path=` | Download one file, or check it exists | `text` returns plain text |
| `GET`/`HEAD /inspect/{uuid}/archive?path=` | PAX tar of a file or directory | Chunked; filename is the path with `/`→`_` plus `.tar` |
| `GET /inspect/{uuid}/grep` | ripgrep | `pattern` (repeatable), `path` (repeatable, default `/`), `glob`, `max_count`, `max_total` (1000, ≤ 10000), `case`, `before`/`after` |

Inspection and file endpoints **don't start a VM**.

## `POST /instances` body (spec `InstanceSpawnRequest`)

| Field | Default | Notes |
| --- | --- | --- |
| `image` * | — | UUID or `tag:NAME` |
| `command` * | — | With `shell: true` this is a shell expression and `args` is ignored. Otherwise it's a path to an executable |
| `args` | `[]` | For direct exec |
| `shell` | **`false`** | `true` inherits the image's `ENV`. `false` gets **only** `env`, with `PATH` defaulting to `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`. Set `env.SHELL` to choose the shell |
| `env` | null | Merged with the image env when `shell: true` |
| `disposable` | **`false`** (saves) | `true` means no result image |
| `timeout` | none in the spec | Seconds; the account max is `limits.instance_max_timeout` |
| `truncate_output_at` | 1048576 | Per stream (stdin, stdout, stderr) in the **record**, max 10485760; stdin delivery is never cut |
| `networking` | `{enabled: true}` | `{enabled: false}` gives the VM no guest NIC ([networking](https://docs.tokenfactory.nebius.com/sandboxes/guides/configure-networking-and-secrets)) |
| `files` | — | `{"/abs/path": {uuid, uid, gid, mode: "0644"}}`, using UUIDs from `POST /files` |
| `stdin` | — | `{value, encoding, close}`. Use `close: false` to keep the pipe open for `/stdin` writes |
| `cwd` | `""` | Absolute, or `""` for the image or server default; created if missing |
| `uid` / `gid` | 0 / 0 | Runs as root by default |
| `hostname` | `linuxkit` | |
| `preserve_env` | false | Writes the merged env into the result image's `metadata/env`. `""` or `null` removes a key. **Not for secrets** |
| `resources_limits.max_layer_bytes` | 12884901888 | Writable layer size |

An `ExecSpec` (for subprocesses) takes `command`, `args`, `shell`, `env`, `cwd`, `uid`, `gid`, `stdin` and
`truncate_output_at` only. VM-level fields are rejected
([subprocess guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-subprocesses-and-send-input)).

## Operation response (spec `OperationResponse`)

`uuid`, `kind`, `status` (`PENDING|ASSIGNED|EXECUTING|SUCCESS|FAILED|CANCELLED`), `error`, `created_at`, `duration`
(seconds), `image_size`, `consumed_cpu`, `consumed_memory`, `image_uuid` (input), `result_image_uuid` ("only set for
completed (SUCCESS) operations"), `metadata` (the request plus `result`), and `result` (for imports:
`{image, tag}`).

`metadata.result`: `state {exit_code, signal, timed_out, pid, core_dump, stopped, continued}`, `stdout`/`stderr`
`{value, encoding: ascii|base64, truncated}`, and raw `resources {user_cpu_time, system_cpu_time, max_rss, elapsed_time,
cost, ...}`. **Read `resources` for diagnostics only.** Units are unconfirmed and `cost` isn't for invoicing
([limits](https://docs.tokenfactory.nebius.com/sandboxes/operate/limits-retention-and-usage)).

**Check two layers:** the operation `status`/`error`, then the process `state`. `SUCCESS` with a nonzero `exit_code`
means the command failed ([run commands](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-commands-and-results)).

## SSE events ([stream guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/stream-output-and-events), [SSE ref](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/stream-the-operation-event-log-via-server-sent-events))

- Frames look like `id: N` / `event: <type>` / `data: {"id", "ts", "spid", "type", "data"}`. Lines starting with
  `: keepalive` are comments to ignore. `event: sse_error` means the stream broke after a `200`, so reconnect.
- Types: `init`, `spawn`, `stdin`, `stdout`, `stderr`, `exit`, `truncated`, `size_cap`, `network`, `shutdown`, and
  `completion` (always last; carries the final status, result image and error). Stream events can be dropped by the
  per-stream and overall size caps; service events are never dropped.
- **Resume:** save an event ID only *after* you've fully processed it, then reconnect with `Last-Event-Id` (or
  `?since=N`). Deduplicate by ID. Retry `410`/`425` after `Retry-After`; retry `502`/`504` from the cursor; treat
  `401`/`403` as credential problems. **Closing the stream does not cancel the operation**, so query the final status
  afterwards.

## Polling pattern ([networking recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/verify-with-networking-disabled))

1. POST once, require `201`, and **store the `uuid` immediately**.
2. GET `/operations/{uuid}` with a per-request timeout and an overall deadline, honouring `Retry-After` (the recipe
   uses at least 1 s between polls). Keep going while the status is `PENDING`, `ASSIGNED` or `EXECUTING`.
3. On a terminal status, check `exit_code == 0`, `!timed_out` and `signal ∈ {null, -1}`, check `truncated`, and
   decode base64 output.
4. If the deadline passes, keep the ID and inspect or `DELETE` it. **Don't** resubmit blindly.

**TypeScript:** no JS client is documented. Use `fetch` with the same headers and JSON. The SSE reference mentions
native `EventSource` handlers, but the docs never say whether an `EventSource` can send the `Authorization` and
`Project` headers. The docs' own clients open the stream as a plain HTTP GET and parse frames by hand (see
[stream recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/stream-a-build-or-test-run)), so do the same.
