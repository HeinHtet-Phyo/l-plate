# Python SDK (`contree-sdk`) reference

Snapshot as of 2026-10-24. Sources are pages under https://docs.tokenfactory.nebius.com/sandboxes/sdk/ and the task
guides. **There is no JS/TS SDK**; from TypeScript, use [rest-api.md](rest-api.md).

## Two SDK lines in the docs (read this first)

| | `contree-sdk==0.3.6` | Explicit-client line |
| --- | --- | --- |
| Pages | [quickstart](https://docs.tokenfactory.nebius.com/sandboxes/start/python-quickstart), every [guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-commands-and-results) and [cookbook](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/index) recipe | [getting started](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/getting-started), [API reference](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/index), [LangChain](https://docs.tokenfactory.nebius.com/sandboxes/sdk/integrations/langchain) |
| Client | `Contree()` / `ContreeSync()` read `NEBIUS_API_KEY` + `NEBIUS_PROJECT_ID` | `Contree(api_client)`, where *"contree_sdk performs no auth, transport, or configuration of its own"* |
| Detached start / output iterator | No ("no public detached-start operation handle", "no event-stream method") | `start()`, `iter_output()` listed |
| Status | Pinned by the guides; latest stable on PyPI (2026-10-24) | Matches GitHub tags `0.4.0.dev3`–`dev5` (pre-releases) |

**Use 0.3.6 and follow the guides.** The table's mapping comes from GitHub (`nebius/contree-sdk`). Tag 0.3.6 has
`Contree(config=None, *, base_url=None, token=None)` with `IAMAuth` reading `NEBIUS_API_KEY` / `NEBIUS_PROJECT_ID`
and falling back to `auth.ini`, and it has no `start` or `iter_output`. The docs never say which version the reference
pages describe.

Install: `uv add "contree-sdk==0.3.6"` (the docs use Python 3.12). The explicit-client line builds its transport from
`contree_client`:

```python
from contree_client.httpx import ContreeAsyncClient           # getting-started page
api_client = ContreeAsyncClient("YOUR-NEBIUS-API-KEY", base_url="https://your-instance.of.contree")
api_client = ContreeAsyncClient.from_profile()                  # profile › CONTREE_PROFILE › auth.ini active
sdk = Contree(api_client)                                       # caller owns the transport lifecycle
# LangChain page instead uses: from contree_client.asyncio import ContreeAsyncClient
```

## Clients ([client ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/client))

```python
class contree_sdk.Contree(client, *, operation_timeout, operation_run_timeout, operation_import_timeout,
                          images_list_batch_size, default_truncate_output_at)      # .images, .files
class contree_sdk.ContreeSync(client, *, ...same...)                               # .images, .files
```

From the 0.3.6 source on GitHub (not in the docs), the `ContreeConfig` defaults are: `operation_timeout` 1000 s
(used when `run(timeout=None)`), `default_truncate_output_at` 65535, `transport_timeout` 10 s, and polling between
0.1 and 10 s with 1.75× backoff.

## Images manager ([images ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/images), [working with images](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/images))

Async signatures are below; on `ImagesManagerSync` the same methods are plain `def`.

| Method | Behaviour |
| --- | --- |
| `await images(number=100, tagged=False, since=None, until=None)` | List images. `number=None` returns all; `since`/`until` take a `datetime` or a `timedelta` back from now. Also `iter_images(...)`, `get_images_list(...)`, `async for` |
| `await images.use(ref, strict=False)` | **No API call** unless `strict=True`, so the tag or UUID resolves at run time. Use `strict=True` to verify up front |
| `await images.oci(ref, *, tag=None, username=None, password=None, timeout=None)` | Like `use(strict=True)`, but imports from the registry if missing. Aliases: `docker`, `podman`, `pull_by_oci`, `pull_image_by_oci`. Raises `NotFoundError` if `ref` is an unknown UUID |
| `await images.import_from(image, *, tag, username, password, timeout)` | **Always** re-imports (`import_image` is the same). Raises `ValueError`, `FailedOperationError`, `CancelledOperationError`, `OperationTimedOutError` |
| `get_image_by_tag(tag)`, `get_image_by_uuid(uuid)`, `parse_ref(ref)` (classmethod → `UUID \| OCIReference`) | Lookups |

`ref` can be a UUID (string or `UUID`), an OCI tag (`"ubuntu:latest"`), a full OCI URL (`"docker://ghcr.io/owner/image:tag"`)
or `OCIReference(url, tag)` (`OCIReference.from_oci(ref)`). Prefer `oci()` over `import_from()`
([images](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/images)).

## Image object: `ContreeImage` / `ContreeImageSync` ([image ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/image))

```python
def run(command=None, *, shell=None, args=None, env=None, cwd=None, hostname=None, stdin=None,
        stdout=str, stderr=str, tag=None, files=None, timeout=None, disposable=True,
        truncate_output_at=None, preserve_env=False) -> ImageLike
```

| Param | Notes |
| --- | --- |
| `command` / `shell` | Mutually exclusive; neither raises `ValueError`. `command="/bin/echo", args=[...]` skips the shell, which is safer for dynamic values |
| `env` | Applies to this command only. With `shell=`, the image's stored env is also available; with direct exec, pass every variable you need ([run commands](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-commands-and-results)) |
| `preserve_env=True` | Needs `disposable=False`. Merges the image's `metadata/env` with `env` (request wins) and writes the result into the new image. `""` removes a key. **Never use it for secrets** |
| `stdin` | `str`, `bytes`, `Path`, a file object, `StringIO`, `BytesIO` |
| `stdout` / `stderr` | `str` (default), `bytes`, `StringIO`/`BytesIO`, a path, or `PIPE` (`Literal[-1]`) for a byte stream |
| `files` | List of local paths, or a dict `{guest_path: local_path \| bytes \| UploadFileSpec}`. **Use absolute guest paths** ([files guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/work-with-files-and-artifacts)). Uploads are deduplicated by content hash |
| `timeout` | Seconds or a `timedelta` |
| `disposable` | **Default `True`, which discards changes.** `False` returns a reusable image |
| `truncate_output_at` | Bytes per stream; the server maximum is 10 MiB. `run.result.truncated` is true if either stream was cut |
| `tag` | Tags the result image after execution. The doc examples always pair it with `disposable=False` |

`run()` **prepares** the run. `await` (async) or `.wait()` (sync) submits it and waits. Running from a disposable
result raises `DisposableImageRunError`.

Result attributes: `exit_code`, `stdout`, `stderr`, `uuid` (`None` when disposable), `tag`, `state`, `elapsed`,
`result` (`ContreeResult`, with `.truncated`) and `request`.

| Other methods (async form) | |
| --- | --- |
| `await image.read(path) -> bytes`, `await image.download(path, local_path=None) -> Path`, `await image.ls(path="/")` | Inspect a stored image **with no VM** |
| `await image.apply_files(files)` | New image with the files baked in |
| `await image.tag_as(tag \| None)`, `await image.untag()` | Tags are unique, so assigning one moves it |
| `image.session() -> ContreeSession` | Same `run()` signature. Saved runs update the session's image reference ([session ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/session)) |
| `start()`, `iter_output()` | **Explicit-client line only** (see above) |

`ls()` returns `ImageFile`/`ImageDirectory` objects with `path`, `size`, `mode`, `uid`, `gid`, `mtime`, `is_dir`,
`is_symlink`, `symlink_to`…; `ImageFile.read()` and `.download(local_path)`
([image_fs](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/image_fs)).

## Sync-only `popen()` ([subprocess ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/subprocess))

```python
def popen(args=None, *, stdin=None, input=None, stdout=None, stderr=None, shell=False, cwd=None,
          timeout=None, check=False, text=None, env=None) -> ContreeProcessSync   # .returncode .stdout .stderr
proc.wait(); proc.communicate(input=..., timeout=...)
```

`popen()` is a **local wrapper around one remote run**. It is *not* the REST additional-subprocess API and can't
attach to a running operation ([sessions & modes](https://docs.tokenfactory.nebius.com/sandboxes/concepts/sessions-and-execution-modes)).

## Files manager ([files ref](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/reference/files))

`await sdk.files.upload(local_path)`, `upload_file(local_path)` and `upload_bytes_file(data)` each return an
`UploadedFile`. Use it with `files={"/script.sh": UploadFileSpec(source=uploaded)}`. **The import path for
`UploadFileSpec` is not documented.**

## Wait and cancel semantics

- When an SDK 0.3.6 wait ends without seeing a terminal state, it **tries a best-effort cancel**. This differs from
  REST, where a disconnect does not cancel. Resolve the operation's real outcome before re-running
  ([lifecycle](https://docs.tokenfactory.nebius.com/sandboxes/concepts/execution-lifecycle)).
- SDK exceptions mean no normal process result exists. Don't read them as a failing command.
- The branching page's "Example 4" says running the same command twice from the same image gives the **same result
  UUID**. Nothing else in the docs explains this
  ([branching](https://docs.tokenfactory.nebius.com/sandboxes/sdk/python_sdk/branching)).

## Integrations

- **LangChain / deepagents:** `pip install "contree-sdk[langchain]"`, then
  `from contree_sdk.langchain.sandbox import ContreeSandbox` and `ContreeSandbox(session=image.session())` as the
  `backend=` of `create_deep_agent`. The page uses the explicit-client line. Its model example points at
  `https://api.studio.nebius.ai/v1/`; see the Token Factory inference skill for the current base URL
  ([LangChain](https://docs.tokenfactory.nebius.com/sandboxes/sdk/integrations/langchain)).
- **Mini-SWE-Agent:** `pip install "mini-swe-agent[contree]"`, `--environment-class contree`. **Currently broken**:
  `ContreeEnvironment` imports the removed `contree_sdk.config.ContreeConfig`, and the doc's example raises
  `RuntimeError` ([mini-swe-agent](https://docs.tokenfactory.nebius.com/sandboxes/sdk/integrations/mini-swe-agent),
  [cookbook warning](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/index)).
