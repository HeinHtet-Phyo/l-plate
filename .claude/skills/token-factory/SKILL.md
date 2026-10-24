---
name: token-factory
description: >-
  Build on Nebius Token Factory (open-model inference, OpenAI-compatible API) for the
  Noetic x Nebius hackathon. Use whenever code calls an LLM, embeds text, generates
  images, or needs a model picked; when wiring tool/function calling, structured JSON
  output, streaming, or RAG; when comparing open models or measuring where they fail;
  or when a Token Factory call errors (401, 404 model not found, 429, bad JSON).
---

# Nebius Token Factory

Token Factory serves open models (Kimi, DeepSeek, Qwen, GLM, MiniMax, Nemotron, gpt-oss, FLUX…)
behind an **OpenAI-compatible API**. Any OpenAI SDK or framework works by changing three things:
**base URL, API key, model ID**.

- Base URL: `https://api.tokenfactory.nebius.com/v1` (older docs say `api.studio.nebius.com` — don't use it)
- Key: `NEBIUS_API_KEY`, from tokenfactory.nebius.com → profile → API Keys
- Playground and model catalogue: https://tokenfactory.nebius.com/models

## Hackathon brief (judging lens)

The goal is *a working example with a clear purpose*. The demo must show **what it does**,
**where the models struggle**, and **why it matters**. So:

- Get one end-to-end path working before adding features. Judging starts 16:30.
- Keep a log of model failures as you go (wrong tool call, bad JSON, hallucinated source,
  slow response). These belong in the demo; don't hide them.
- Model IDs live in one config constant, so swapping or comparing models is a one-line change.

## Setup

Keys go in `.env` (gitignored), never in source, never echoed into chat or logs.

```bash
# .env
NEBIUS_API_KEY=your_key_here
```

Verify key + endpoint before debugging anything else (prints model IDs, not the key):

```bash
set -a; source .env; set +a
curl -s https://api.tokenfactory.nebius.com/v1/models -H "Authorization: Bearer $NEBIUS_API_KEY" \
  | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data']]"
```

Python: prefer `uv` (`uv add openai python-dotenv pydantic`).

```python
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url="https://api.tokenfactory.nebius.com/v1", api_key=os.environ["NEBIUS_API_KEY"])

resp = client.chat.completions.create(
    model="moonshotai/Kimi-K3",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
)
print(resp.choices[0].message.content)
```

JS/TS: `new OpenAI({ baseURL: "https://api.tokenfactory.nebius.com/v1", apiKey: process.env.NEBIUS_API_KEY })`.
LiteLLM: `model="nebius/<model-id>"`. LangChain: `ChatOpenAI(base_url=..., api_key=..., model=...)`.

## Picking a model

Featured models per the official cookbook (October 2026). **Always confirm exact IDs and
casing against `/v1/models`**, since the catalogue changes and a wrong ID returns a 404.

| Model ID | Notes | Reach for it when |
|---|---|---|
| `moonshotai/Kimi-K3` | 2.8T, 1M ctx, strong reasoning + agentic | Default "smartest" choice for agents |
| `deepseek-ai/DeepSeek-V4-Pro` | 1.6T MoE (49B active), 1M ctx | Hard reasoning, second opinion |
| `zai-org/GLM-5.2` | 753B, 1M ctx, good tool use | Tool-calling agents |
| `Qwen/Qwen3.5-397B-A17B` | 397B MoE (17B active), 262K ctx | Reasoning + code, faster than the giants |
| `moonshotai/Kimi-K2.7-Code` | 1T MoE (32B active), 256K ctx, multimodal | Coding companions, code explanation |
| `MiniMaxAI/MiniMax-M3` | 428B MoE, 1M ctx, text+image+video in | Multimodal input |
| `nvidia/nemotron-3-super-120b-a12b` | 120B MoE (12B active), efficient | Cheap/fast high-volume steps |
| `openai/gpt-oss-120b` | Reasoning model | Structured extraction (used in cookbook JSON example) |
| `Qwen/Qwen3-Embedding-8B` | Embeddings | RAG retrieval |
| `black-forest-labs/flux-schnell` / `flux-dev` | Image generation | Creative demos |

Rules of thumb: use a big model for the reasoning step and a small, fast one for routing,
classification and summarising. Before you commit to a model for an agent, check that it
reliably makes tool calls on *your* tools.

## Core patterns

**Streaming.** Use `stream=True` and read `chunk.choices[0].delta.content`, which can be `None` on some chunks.

**Reasoning models.** Their thinking comes back separately in `message.reasoning_content`
(`delta.reasoning_content` when streaming). Show it in the UI if it helps the demo; never parse answers out of it.

**Structured output.** Pass the JSON schema via `guided_json` and also force JSON mode:

```python
from pydantic import BaseModel
class Ticket(BaseModel):
    issue_type: str
    urgency: str
    summary: str

resp = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[{"role": "system", "content": f"Extract fields as JSON matching: {Ticket.model_json_schema()}"},
              {"role": "user", "content": text}],
    extra_body={"guided_json": Ticket.model_json_schema()},
    response_format={"type": "json_object"},
    temperature=0.1,
)
ticket = Ticket.model_validate_json(resp.choices[0].message.content)
```

**Tool calling.** This is the standard OpenAI `tools=[{"type": "function", "function": {...}}]` loop.
Loop until `message.tool_calls` is empty, and append each result as
`{"role": "tool", "tool_call_id": ..., "content": ...}`. Wrap `json.loads(call.function.arguments)`
in try/except. On a parse failure, return the error as the tool result so the model can retry.
Cap the number of iterations (around 10) so a confused model can't loop forever.

**Embeddings.** Use `client.embeddings.create(model="Qwen/Qwen3-Embedding-8B", input=[...])` and read
`[d.embedding for d in resp.data]`. For a one-day build an in-memory numpy cosine search is enough;
skip the vector DB unless the corpus is large.

**Concurrency.** Use `AsyncOpenAI` with an `asyncio.Semaphore` (about 5–10) and retry with backoff on 429.

## Comparing models (the "where models struggle" story)

A small harness pays for itself: run the same task set across 2–4 model IDs and record the
output, latency, token usage (`resp.usage`) and pass/fail against expected answers or a
judge model. Show a table or chart in the demo. Starting points in the cookbook:
`agents/agent-cost-comparison-1`, `agents/camel-ai-model-comparison-agent`.

## Don't start from a blank file

The official cookbook (https://github.com/nebius/token-factory-cookbook) has working recipes:

| Need | Recipe |
|---|---|
| Tool calling | `tool-calling/function_calling_1.ipynb`, `tool-calling/tavily_tool_calling.ipynb` (web search) |
| Structured JSON | `guided_json.ipynb` |
| RAG over PDFs | `rag/chat-with-pdf`, `rag/rag-pdf-llama-index` |
| Agent frameworks | `agents/` (LangChain deep agents, CrewAI, Agno, Google ADK, Pydantic AI, LlamaIndex, Strands) |
| Deep research agent | `agents/universal-deep-research-nebius`, `workshops/deep-research-writing-agents-nebius-okahu` |
| Fine-tuning / distillation | `post-training/`, `workshops/token-factory-workshop/distillation.md` |

Clone it outside this repo (for example `~/src/token-factory-cookbook`) and copy across only what you adapt.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `401` | Key missing, mis-copied or not loaded. Check `.env` is loaded and the header is `Authorization: Bearer …`. Ask Nebius staff on-site about credits |
| `404` / model not found | Exact ID and casing from `/v1/models` |
| Connection error | Base URL must be `https://api.tokenfactory.nebius.com/v1` (with `/v1`) |
| `429` | Lower concurrency, add backoff |
| Invalid JSON | Use `guided_json` + `response_format`, lower the temperature, validate with Pydantic and retry once |
| Model ignores tools | Make tool descriptions explicit, set `tool_choice="required"` for the first step, or try GLM-5.2 / Kimi-K3 |
| Context too long | Trim old tool results, summarise, or paginate before re-sending |
