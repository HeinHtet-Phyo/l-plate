# Model failures log

> **This is demo material.** Judges want to see *where the models struggle*. Log every notable failure the
> moment it happens, even when you've already worked around it: wrong or missing tool calls, invalid JSON,
> hallucinated facts or sources, ignored instructions, refusals, slow responses, timeouts, 429s.
>
> **Append-only.** Add new entries at the bottom and end each one with a blank line. Never edit someone else's entry.
> Never paste API keys or `.env` contents.
>
> Format:
>
> ```
> ## YYYY-MM-DD HH:MM: <model-id>: <one-line symptom> (@handle)
> - **Task:** what we asked it to do (short prompt/tool summary; link `file:line`)
> - **Expected:** …
> - **Got:** short excerpt of the actual output or error
> - **How often:** e.g. 1/1, 3/10 runs
> - **Cost:** latency / tokens if relevant
> - **Workaround:** what we changed (prompt, model, guided_json, retries…) or "none yet"
> - **Demo-worthy:** yes / no
> ```

<!-- No entries yet. Add the first one below this line. -->

