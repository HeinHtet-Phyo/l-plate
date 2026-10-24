# MCP server (`contree-mcp`) reference

Snapshot as of 2026-10-24. Sources: https://docs.tokenfactory.nebius.com/sandboxes/mcp/index and its subpages. The
docs don't pin a server version (PyPI's latest on 2026-10-24 was 0.5.0). **They also tell you to check the tool list
your connected server exposes**
([reference map](https://docs.tokenfactory.nebius.com/sandboxes/reference/index)).

## Register the server

Run `contree auth` once (see [cli.md](cli.md)). It writes `~/.config/contree/auth.ini`, which the server reads, so
**client configs need no secrets** ([configuration](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/configuration)).
Never commit a token in an MCP config.

| Client | Documented config ([quickstart](https://docs.tokenfactory.nebius.com/sandboxes/mcp/quickstart)) |
| --- | --- |
| Claude Code | `claude mcp add --transport stdio contree -- $(which uvx) contree-mcp`, then restart or run `/mcp` to verify |
| Claude Desktop | `claude_desktop_config.json` → `{"mcpServers": {"contree": {"command": "uvx", "args": ["contree-mcp"]}}}` |
| OpenAI Codex CLI | `~/.codex/config.toml` → `[mcp_servers.contree]`, `command = "uvx"`, `args = ["contree-mcp"]` |
| **Cursor** | **Not documented** in the Sandboxes docs. The Claude Desktop `mcpServers` block is the documented generic stdio form |

Debug by adding `"--log-level", "debug"` to `args`. `contree-mcp --version` prints the User-Agent
([MCP troubleshooting](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/troubleshooting)). For manual
installs: `uv pip install contree-mcp`, `pip install contree-mcp`, or `pip install --break-system-packages contree-mcp`
in PEP 668 containers.

## Auth precedence (field by field, highest first)

```
token    --token   >  CONTREE_TOKEN   >  NEBIUS_API_KEY*    >  profile.token
project  --project >  CONTREE_PROJECT >  NEBIUS_AI_PROJECT* >  profile.project
url      --url     >  CONTREE_URL                           >  profile.url  >  IAM default
*NEBIUS_* are used only when BOTH are set; a lone NEBIUS_API_KEY is ignored (info log), and the profile loads instead
```

`type = iam` (recommended) sends `Authorization: Bearer` + `Project`, with default URL
`https://api.tokenfactory.nebius.com/sandboxes`. `type = jwt` is the legacy `contree.dev` deployment and needs no
project. Errors you may see: "No API token configured", "IAM auth requires a project ID", and Forbidden (the token
lacks `spawn`, `import`, `set_image_tag` or `cancel`; the server can't escalate). Env-passed tokens can show up in
process listings ([configuration](https://docs.tokenfactory.nebius.com/sandboxes/mcp/integration/configuration)).

## Server options

| Option | Env | Default |
| --- | --- | --- |
| — | `CONTREE_HOME` | `$XDG_CONFIG_HOME/contree` (holds `auth.ini` and MCP state) |
| `--profile` / `--token` / `--url` / `--project` | `CONTREE_PROFILE` / `CONTREE_TOKEN` / `CONTREE_URL` / `CONTREE_PROJECT` | from the profile |
| `--mode` | — | `stdio` (or `http`) |
| `--http-port` / `--http-listen` | — | `9452` / `127.0.0.1`. **No auth is documented for HTTP mode**; the docs show `0.0.0.0` "for network access from other machines" |
| `--log-level` | — | `warning` |
| — | `CONTREE_NO_UPDATE_CHECK` | unset (daily PyPI check) |
| `--cache-files` / `--cache-general` / `--cache-prune-days` | — | `$CONTREE_HOME/mcp/files.db` / `.../mcp/cache.db` / `60` |

## Tools ([tools index](https://docs.tokenfactory.nebius.com/sandboxes/mcp/tools/index), one page each under `mcp/tools/`)

| Tool | Params (default) | VM? |
| --- | --- | --- |
| `run` | `command`*, `image`* (UUID or `tag:name`), `shell` (true), `disposable` (**true**), `directory_state_id`, `files` (`{"/guest/path": "upload-uuid"}`, keyed by destination), `wait` (true), `timeout` (**30**), `env`, `cwd` (`/root`), `stdin`, `truncate_output_at` (**8000**) | yes (~2–5 s) |
| `rsync` | `source`* (local path or glob), `destination`*, `exclude` ([]) → `directory_state_id` | no |
| `upload` | one of `content`, `content_base64` or `path` (a **local** absolute path) → `{uuid}` | no |
| `download` | `image`*, `path`*, `destination`* (absolute path on the **MCP host**, parent dirs auto-created), `executable` (false) | no |
| `import_image` | `registry_url`* (`docker://python:3.11-slim`), `tag`, `wait` (true), `i_accept_that_anonymous_access_might_be_rate_limited` (false) | yes |
| `registry_token_obtain` | `registry_url`*. Opens a browser to create a PAT | no |
| `registry_auth` | `registry_url`*, `username`*, `token`*. Validates and **stores** the credentials (where is not documented) | no |
| `list_images` | `limit` (100, 1–1000), `offset`, `tagged`, `tag_prefix`, `since` (`"1h"`), `until` | no |
| `get_image` | `image`* | no |
| `set_tag` | `image_uuid`*, `tag` (omit to remove) | no |
| `list_files` | `image`*, `path` (`/`) | no |
| `read_file` | `image`*, `path`* → `content`, `encoding` (`utf-8`/`base64`), `bytes_size` | no |
| `grep` | `image`*, `pattern`* (Rust regex), `path`, `glob`, `max_count`, `max_total` (1000), `case` | no |
| `get_operation` | `operation_id`* | no |
| `list_operations` | `limit` (100), `status`, `kind`, `since` | no |
| `wait_operations` | `operation_ids`*, `mode` (`all`/`any`), `timeout` (300) | no |
| `cancel_operation` | `operation_id`* | no |
| `get_guide` | `section`*: `workflow`, `reference`, `quickstart`, `state`, `async`, `tagging`, `errors` | no |

`run` returns `exit_code`, `timed_out`, `state`, `result_image`, `filesystem_changed`, `stdout` and `stderr`; with
`wait=false` it returns `{operation_id}`. When `filesystem_changed` is false, `result_image` equals the input image.
**No tool streams events or controls subprocesses**; use REST for that.

## Resources ([resources](https://docs.tokenfactory.nebius.com/sandboxes/mcp/resources))

`contree://image/{image}/read/{path}` (path has no leading slash) · `contree://image/{image}/ls/{path}` (`.` is the
root) · `contree://image/{image}/lineage` (parent, children, ancestors, root, depth, for rollback) ·
`contree://guide/{section}` · `contree://operations/instance/{id}` · `contree://operations/import/{id}` (cached
results).

## Prompts ([prompts](https://docs.tokenfactory.nebius.com/sandboxes/mcp/prompts/index))

`prepare-environment` (`task`, `base`, `project`, `packages`), `run-python` (`code`), `run-shell` (`command`,
`image`), `sync-and-run` (`source`, `command`, `image`), `install-packages` (`packages`, `image`), `parallel-tasks`
(`tasks`, `image`), `build-project` (`source`, `install_cmd`, `test_cmd`), `debug-failure` (`operation_id`),
`inspect-image` (`image`), `multi-stage-build` (`source`, `install_cmd`, `build_cmd`, `test_cmd`).

## Working rules ([cheatsheet](https://docs.tokenfactory.nebius.com/sandboxes/mcp/cheatsheet), [patterns](https://docs.tokenfactory.nebius.com/sandboxes/mcp/patterns))

1. Call `list_images` before `import_image`, and authenticate to the registry first, because anonymous pulls get
   rate-limited.
2. `rsync` once, then reuse `directory_state_id` for the whole session; re-sync only when files change. Always exclude
   `__pycache__`, `.git`, `.venv`, `node_modules`, `target`, `dist`.
3. Run one step per command with `disposable=false` (`apt`, then `pip`, then `python`…) so each step is a rollback
   point. Roll back by running from an ancestor UUID; nothing needs cleaning up.
4. For parallel work, use `run(wait=false)` × N, then `wait_operations`. Don't use `wait=false` for a single op.
5. Raise `timeout` for long jobs and `truncate_output_at` for big output. A "Directory state not found" error means
   re-run `rsync`.
6. Tag only images you reuse often; use UUIDs for everything else.

## Doc conflicts

- The tool count reads "15 tools" on the overview and quickstart but "All 18 tools" on the tools index; the cheatsheet
  table lists 15 (it omits `grep`, `registry_auth` and `registry_token_obtain`).
- Troubleshooting says to "ask the `whoami` tool", but no `whoami` tool page exists.
- The GitHub README (`nebius/contree-mcp`, default branch, 2026-10-24) names the tools `contree_run`,
  `contree_list_images`… while the docs use bare names. Use whichever names the connected server lists.
- `directory_state_id` is an integer (`42`) on the `rsync`/`run` pages but a string (`"ds_xyz789..."`) on the
  quickstart and overview.
- MCP pages promise "full network/filesystem isolation", yet guest networking is **on** by default and MCP has no
  switch to turn it off.
