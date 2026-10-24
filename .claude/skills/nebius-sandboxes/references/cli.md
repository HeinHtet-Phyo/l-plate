# CLI (`contree-cli`) reference

Snapshot as of 2026-10-24. The docs pin **0.9.4**, which is also the latest on PyPI that day. Sources:
https://docs.tokenfactory.nebius.com/sandboxes/cli/index and the pages under `cli/commands/` and `cli/tutorial/`.

**For coding agents** (from `contree --help`, [command index](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/index)):
read `contree agent` first, then `contree <command> --help`, and only then run task commands. If auth is missing or
invalid, ask the user to run `contree auth`.

## Install & auth ([installation](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/installation), [configuration](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration))

```bash
uv tool install "contree-cli==0.9.4"     # or pip / pipx; needs Python ≥ 3.10; one runtime dep: contree-client
contree auth                             # prompts for the token (no echo) and the project ID; checks GET /v1/whoami
NEBIUS_API_KEY=... NEBIUS_AI_PROJECT=... contree auth -y     # non-interactive
contree auth ls [-O]                     # status: ok | inactive | timeout | error | offline mode | no url
contree auth switch NAME · contree auth remove NAME [-y] · contree auth --profile=NAME
```

`auth` flags: `--token`, `-u/--url`, `--type {iam,jwt}`, `-P/--project`, `-p/--profile`, `-f`. Env fallbacks are read
**only by `auth`**: `CONTREE_TOKEN`/`NEBIUS_API_KEY`, `CONTREE_URL`, `CONTREE_PROJECT`/`NEBIUS_AI_PROJECT`. All other
commands read the saved profile. The runtime order is flag › profile › the IAM default URL
`https://api.tokenfactory.nebius.com/sandboxes`.

```ini
# ~/.config/contree/auth.ini (mode 0600); also read by the SDK and MCP
[DEFAULT]
profile = default
[profile:default]
type = iam
url = https://api.tokenfactory.nebius.com/sandboxes
token = ...
project = ...
```

`cli.ini`, in the same directory, is hand-edited and read only by the CLI. Its `[cli]` section sets `log_level`,
`output_format` and `editor`, and it can hold extra `[profile:NAME]` sections; `auth.ini` wins on conflict. The docs
disagree on the default `type` (`jwt` in the `cli.ini` table, `iam` in `auth --help`), so always set it.

## Global flags & env ([command index](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/index))

| Flag / var | Meaning |
| --- | --- |
| `-p/--profile`, `--token`, `-u/--url`, `-P/--project` | Override for one invocation. `--token` shows up in process listings |
| `-c/--config PATH` | Config file (default `~/.config/contree/auth.ini`) |
| `-o/--format {csv,default,json,json-pretty,plain,table,toml,tsv}` | Output format. **Put it before the subcommand**: `contree -o json run ...` |
| `-L/--log-level`, `-S/--session KEY` | Log level; explicit session key |
| `CONTREE_HOME`, `CONTREE_PROFILE`, `CONTREE_SESSION`, `CONTREE_SESSION_DB`, `CONTREE_NO_UPDATE_CHECK` | Data dir, profile, session, session DB path, disable the PyPI update check |

## Commands

| Command | Does | VM? |
| --- | --- | --- |
| `use [IMAGE] [-N]` | Set or show the session image (UUID or `tag:NAME`). Prints an `export` line, so `eval $(contree use tag:ubuntu:latest)` works. `-N` starts a new session | no |
| `run [opts] -- CMD` (`r`) | Spawn an operation from the session image (below) | **yes** |
| `build [context]` (`bd`) | Build an image from a Dockerfile subset (below) | yes, one per `RUN` |
| `images [list\|import]` (`i`, `img`) | `--prefix`, `-i UUID`, `-a` (include untagged; the default is tagged only), `--since`, `--until`, `--limit` (3000). `import REFS... [--username U] [--password] [-t S]` | import: yes |
| `tag [IMAGE_REF] TAG [-U]` (`t`) | Tag the session image, or a given image; `-U` removes the tag | no |
| `ps` / `op ls` | `-q`, `-a`, `--status {P,A,E,S,F,C,...}`, `-k {image_import,instance}`, `--since`, `--until`, `-M` | no |
| `show UUID` / `op show UUID... [--raw]` | Results. `@`, `HEAD~N` and `@N` refer to session history | no |
| `op wait [UUID...] [-a] [-t 60]` | Poll to a terminal state. Exits `1` if any op isn't `SUCCESS` or the timeout hits; otherwise exits with the command's exit code. **Never updates the session** | no |
| `kill` / `op cancel [UUID...] [-a]` | Cancel. **`--all` cancels every active op in the project** | no |
| `op events` (`ev`) | "Print an operation's full raw event log" | no |
| `ls [path]`, `cat path`, `cp path dest`, `grep PATTERN [path...]` | Read the session image through `/inspect/`. `grep` takes `--glob`, `--max-count`, `--max-total`, `--case`, `-A/-B/-C` | **no** |
| `export` | "Export image rootfs or a subtree as tar.gz". **No doc page** | no |
| `cd [path]` | Set the session cwd; checked against the image | no |
| `env [KEY=VAL...] [-U KEY]` | Session env applied to every `run`. `-e` on a run overrides it | no |
| `file edit PATH` / `file cp SRC DEST` / `file ls` | Stage edits or uploads as **pending files** for the next run | no |
| `session [list\|use\|branch\|checkout\|rollback\|show\|wait\|delete]` (`s`) | Local branches and history (below) | no |
| `shell` (`sh`) | Interactive REPL. Bare commands run with default options | yes |
| `skill install\|list\|upgrade\|remove [SPEC]` | Install bundled ConTree agent skills. Specs: `claude:` (`.claude/skills/contree`), `claude:~`, `codex:`, `claude-agent:`, `claude-subagent:`, `opencode:`, `amp:`, `cline:` | no |
| `agent [TOPIC]` / `man` | Built-in manual for coding agents | no |

**In this repo:** `contree skill install` with no specs writes to **every** global agent home. Team skills live in
`.claude/skills/` and ship with git, so ask before running it. If the team wants the ConTree skill, use the `claude:`
spec (it writes `.claude/skills/contree`) and commit the result.

## `contree run` ([run](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/run))

| Flag | Default | Meaning |
| --- | --- | --- |
| `-t/--timeout` | 120 | Seconds |
| `-D/--disposable` | off | **Without it the run saves its changes and advances the session image** |
| `-s/--shell` | off | Join the args into one shell expression |
| `-I/--interpreter` | | Shebang mode: `#!/usr/bin/env -S contree run -I` |
| `-F/--file host[:/inst][:uUID][:gGID][:mMODE]` | host stat | Attach a file or directory, deduplicated by SHA-256. Directories skip `.*`, `.git`, `*.pyc`, `__pycache__`, `.venv`, `.mypy_cache`, `.pytest_cache`, `node_modules`, `dist`, `build` |
| `--file-excludes PAT...` | | Extra excludes |
| `-e/--env KEY=VAL` | | Repeatable |
| `-C/--cwd` | `""` | `""` means the image's WORKDIR |
| `-H/--hostname` | `linuxkit` | |
| `-T/--truncate` | 65536 | Output bytes |
| `--preserve-env` | | Keep env from the previous run (server side) |
| `-d/--detach` | | Return as soon as the run is spawned |
| `--use IMAGE` | | Switch the image, then run; recorded in history so it can be rolled back |

There is **no networking flag**; disabling the network is REST-only. The CLI propagates the sandbox exit code. The
first Ctrl-C sends SIGINT to the process; a second one cancels the operation. Piped stdin is streamed in chunks.

## Sessions & branches ([sessions tutorial](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/sessions), [session cmd](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/session))

- The session key comes from `-S`, then `CONTREE_SESSION`, then an auto key built from profile + PID + TTY. **A new
  terminal gets a new session**, so export a key for scripts.
- Each non-disposable `run` adds a history entry and advances the branch. `session branch NAME [--from B]`,
  `session checkout B`, `session rollback [N | -N | +N]` (**a bare positive N is an absolute history ID**; write
  `rollback -- -3` to go back three), `session show [-a]`, `session use KEY` (import another session's tip), and
  `session delete KEY [-y]`.
- `session wait` with no IDs drains the detached ops and **advances** the branch. With explicit UUIDs it only polls.
- A session keeps the image pointer, cwd, staged files and history, never a VM.

## Detached fan-out ([operation](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/operation), [workflows](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/workflows))

```bash
A=$(contree -o json run -d --disposable -- pytest tests/a | jq -r .uuid)
B=$(contree -o json run -d --disposable -- pytest tests/b | jq -r .uuid)
contree op wait "$A" "$B" && contree op show "$A" "$B"
# Non-disposable legs: recover the image yourself
IMG=$(contree -o json op show "$A" | jq -r .image); contree use "$IMG"
```

## `contree build` ([build cmd](https://docs.tokenfactory.nebius.com/sandboxes/cli/commands/build), [tutorial](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/build))

Options: `--dockerfile PATH`, `--tag NAME[:TAG]`, `--build-arg K=V`, `--no-cache`, and `-t` (the per-`RUN` timeout,
default 600 s). It interprets a Dockerfile **subset on the client**. It is not a Docker build service.

- Implemented: `FROM` (auto-imports missing tags), `RUN` (one operation each), `COPY [--chown] [--chmod]` (honours
  `.dockerignore`), `ADD` (URLs stream through `POST /v1/files`; archives aren't extracted; no auth), `WORKDIR`,
  `ENV`, `ARG`, `USER`.
- Skipped with a warning: `CMD`, `ENTRYPOINT`, `LABEL`, `EXPOSE`, `VOLUME`, `STOPSIGNAL`, `MAINTAINER`, `HEALTHCHECK`,
  `ONBUILD`, `SHELL`, `COPY --from=stage`.
- Multi-stage: the prose says `AS` is "parsed but ignored", but the `--help` text says "multistage supported". The
  docs conflict, so don't rely on it.
- The layer cache is per context and keyed by content SHA-256. Record the final UUID, because the tag moves.

## Images & tags ([images tutorial](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/images))

Tags are scoped to the project, unique (assigning one moves it), and case-sensitive. Allowed characters are `a-z`,
`0-9`, `_` and `-`, with `:`, `/` and `.` as separators, up to 256 characters. Your tag shadows a public tag of the
same name until you remove it. Private-registry credentials are "used only for the import operation and discarded",
according to the CLI docs.

## Storage ([configuration](https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration))

`CONTREE_HOME` defaults to `$XDG_CONFIG_HOME/contree`, or `~/.config/contree`. It holds `auth.ini`, `cli.ini`, the
per-profile session SQLite DB (the path conflicts: `sessions-{profile}.db` vs `cli/sessions/{profile}.db`) and
`cli/skills.db`.
