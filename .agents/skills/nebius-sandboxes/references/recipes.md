# Recipes (condensed cookbook)

Snapshot as of 2026-10-24, from the [cookbook](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/index). The Python recipes use
`contree-sdk==0.3.6` with `client = Contree()` inside `async def main()`, and the REST ones send the headers from
[rest-api.md](rest-api.md). Each original recipe includes a full program and its expected output, so open it when
adapting one.

## 1. Prepare once, branch many ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/prepare-once-reuse-safely))

```python
base = await client.images.oci("docker.io/library/alpine:3.19")          # import only if missing
prep = await base.run(shell="mkdir -p /workspace && printf 'v1\\n' > /workspace/p.txt",
                      disposable=False, timeout=60)
assert prep.exit_code == 0 and prep.uuid is not None
ckpt = await client.images.use(prep.uuid, strict=True)
a, b = await asyncio.gather(ckpt.run(shell="cat /workspace/p.txt", disposable=True, timeout=30),
                            ckpt.run(shell="cat /workspace/p.txt", disposable=True, timeout=30))
```

Record `prep.uuid` together with the setup revision. Disposable readers return `uuid is None` and can't change the
checkpoint. Retention is 180 days.

## 2. Try two fixes, keep the passing branch ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/try-two-coding-fixes), [guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/branch-compare-and-recover))

```python
left, right = await asyncio.gather(
    baseline.run(shell="python test_calc.py", files={"/repo/calc.py": FIX_A.encode()},
                 cwd="/repo", disposable=False, timeout=30),
    baseline.run(shell="python test_calc.py", files={"/repo/calc.py": FIX_B.encode()},
                 cwd="/repo", disposable=False, timeout=30))
passing = [r for r in (left, right) if r.exit_code == 0 and r.uuid is not None]
if len(passing) != 1: raise RuntimeError("Selection is ambiguous")
assert await passing[0].read("/repo/calc.py") == FIX_B.encode()          # verify the saved bytes
chosen = await client.images.use(passing[0].uuid, strict=True)            # continue from here
```

There is **no merge**. The chosen branch keeps its files, not the process that ran the tests. This is the basis for
SWE-agent tree search (MCTS, beam search, rollbacks), per [SWE agents](https://docs.tokenfactory.nebius.com/sandboxes/swe-agents).

## 3. Recover from a known-good image ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/recover-from-known-good-image))

After a failed, cancelled or timed-out run, **restart from the recorded checkpoint UUID**. Don't assume the failed run
produced reusable state; follow the result-image rules in
[concepts](https://docs.tokenfactory.nebius.com/sandboxes/concepts/images-checkpoints-and-branches#interpret-the-result-image).
When the SDK raises (a platform failure, cancellation, or wait timeout that triggers a best-effort cancel), inspect the
operation before retrying.

## 4. Generate and download a binary artifact ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/generate-and-download-binary-artifact))

```python
run = await base.run(shell="python /gen.py", files={"/input.bin": PAYLOAD, "/gen.py": SRC.encode()},
                     disposable=False, timeout=30)
assert run.exit_code == 0 and run.uuid is not None        # a saved image is REQUIRED to download
await run.download("/out/result.bin", Path("result.bin"))
remote_sha = (await run.read("/out/result.sha256")).decode().strip()   # verify the digest locally
```

Captured stdout is capped, so binaries go in files. If a download fails, retry the read by image UUID **rather than
re-running untrusted code**. For a whole directory, use `GET /inspect/{uuid}/archive`.

## 5. Build and refresh a custom environment (CLI) ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/build-reusable-custom-environment))

```bash
export CONTREE_SESSION="docs-custom-env-$$"; tag="docs/custom-env-$CONTREE_SESSION:current"
contree build . --tag "$tag"
contree use "tag:$tag" >/dev/null
first_uuid=$(contree -o json use | jq -er .current_image)    # record the UUID; the tag moves
contree run -D -- cat /app/version.txt                       # -D keeps the session on first_uuid
contree build . --build-arg MESSAGE=version-2 --tag "$tag"  # refresh gives a new UUID
```

Refresh rules ([update images](https://docs.tokenfactory.nebius.com/sandboxes/operate/update-images-and-clients)):
pin inputs, rebuild, record the new UUID, run a disposable smoke test, then move the tag. Keep the previous UUID for
rollback.

## 6. Verify with networking disabled (REST) ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/verify-with-networking-disabled))

1. `POST /v1/instances` `{"image": IMG, "command": "set -e\n<prepare>", "shell": true, "networking": {"enabled": true}, "disposable": false, "timeout": 30, "truncate_output_at": 1048576}`, then poll and take `result_image_uuid`.
2. Run the same request from that UUID with `"networking": {"enabled": false}, "disposable": true`, where the
   verification script asserts that every entry in `/sys/class/net/*` is `lo`.

The network setting applies to the whole operation, subprocesses included, and is **not** carried into the saved
image.

## 7. Stream a build or test run (REST SSE) ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/stream-a-build-or-test-run))

Create the operation, then `GET /v1/operations/{id}/events?follow=1`. For each complete frame, decode the
`stdout`/`stderr` value (`base64` or `ascii`), display it, and *then* save the ID. Reconnect with
`Last-Event-Id: <saved>` and skip IDs you've already seen. Finish with `GET /v1/operations/{id}`; a failing test
shows up as operation `SUCCESS` with `process_exit=1`.

## 8. Interact with a running process (REST) ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/interact-with-a-process), [guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-subprocesses-and-send-input))

1. Start a parent that prints `parent-ready`, then waits **with a bound** for a completion file, e.g.
   `while [ ! -f /tmp/done ] && [ "$i" -lt 20 ]; do sleep 1; done`.
2. Poll `GET /operations/{id}?inflight=1` until the status is `ASSIGNED`/`EXECUTING` **and** stdout contains the
   readiness marker.
3. `POST /operations/{id}/subprocesses` `{"command": ..., "shell": true, "stdin": {"value": "", "encoding": "ascii", "close": false}}` returns a `spid`; retry `425` after `Retry-After`.
4. `POST .../subprocesses/{spid}/stdin` `{"value": "first line\n", "close": false}`, then `{"value": "second line\n", "close": true}`.
   Requests must be serialized. `204` means accepted; `504` means delivery is unknown, so don't retry. The API adds
   no newline.
5. Poll `GET .../subprocesses/{spid}` (retry `425`), then wait for the parent to reach a terminal state.
6. In a `finally` block, `DELETE /operations/{id}` for every op you still own.

A child signalled with `SIGTERM` reports `signal=15` and `exit_code=-1`. If the parent finishes first, finalization
kills the child.

## 9. Bounded evaluation batch (REST) ([recipe](https://docs.tokenfactory.nebius.com/sandboxes/cookbook/run-bounded-evaluation-batch), [guide](https://docs.tokenfactory.nebius.com/sandboxes/guides/run-concurrent-workloads))

- Hold a semaphore slot from submission **until the op is terminal**. An HTTP connection limit doesn't cap remote
  operations. Stay well under the 50-op Beta ceiling and the `whoami` limit.
- For each item, record the item ID and attempt, input image UUID, operation ID, persistence mode, terminal status,
  process state and result image UUID.
- Classify each outcome: `passed`, `test-failure` (nonzero exit), `timeout`/`signal`, platform `FAILED`,
  `cancelled`, or `cleanup-uncertain`.
- On early stop, `DELETE` only the IDs this batch owns. **Never cancel project-wide.**

## 10. MCP agent loop ([patterns](https://docs.tokenfactory.nebius.com/sandboxes/mcp/patterns))

`list_images` → `import_image` (only if needed) → `rsync` (once) → `run(..., disposable=false)` once per install step
→ `run(...)` the task from the newest `result_image` → `download` artifacts. To roll back, run from an ancestor UUID
(read `contree://image/{uuid}/lineage`).
