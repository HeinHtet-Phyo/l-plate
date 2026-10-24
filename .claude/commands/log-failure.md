---
description: Log a model failure in docs/MODEL_FAILURES.md as raw material for the demo's "where models struggle" story
argument-hint: "<what the model did wrong>"
---

# /log-failure: log where a model struggled

What happened: $ARGUMENTS

1. **Collect the facts** from the conversation, the logs, or a quick rerun:
   - the exact **model ID** (from the code/config, not from memory)
   - the task and prompt (summarise it; link to the code with `file:line`)
   - what was expected, and what came back (a short excerpt or the exact error text)
   - how often it happens (`n/m` runs). If it's cheap, rerun 3–5 times to get a real number.
   - latency or token usage, if relevant (`resp.usage`)
   - the workaround: prompt change, `guided_json`, a lower temperature, retries, or a different model
2. **Append** the entry at the bottom of `docs/MODEL_FAILURES.md` in the format at the top of the file, with the timestamp from
   `date '+%Y-%m-%d %H:%M'`. End it with a blank line. **Never** include API keys, `.env` contents or personal data.
3. Mark it **Demo-worthy: yes** if it's reproducible, easy to explain in one sentence, and shows a real limitation.
   The `demo-prep` skill builds the struggle section from those entries.
4. Commit it (`docs(failures): <model>: <symptom>`). Push now if a teammate is working with the same model or prompt.
   Otherwise push with your next handoff.
