---
title: Running free
description: Ollama, free endpoints, hardware, small-model mode — and how models did on the evals.
---

No feature needs a paid API. Two providers cover everything: **Ollama** (local) and **OpenAI-compatible** endpoints (Groq, OpenRouter, Cerebras and other free tiers).

- **Local.** `ollama pull qwen3.5:9b`, with `--small-model` for models of about 9B parameters or fewer. Hardware notes per model will come with the first local eval results; none are published yet.
- **Free hosted.** Set the key and `PLANNER_MODEL=openai-compatible:groq:<model>`. Free tiers limit tokens per minute and per day; the engine waits as long as a 429 asks and retries. A small-mode job uses tens of thousands of tokens.
- **Roles.** `PLANNER_MODEL` does the reasoning; `EXTRACTOR_MODEL` reads untrusted text (a small model is fine); `JUDGE_MODEL` answers yes/no for citations.
- **Small-model mode** (`--small-model`) halves tool budgets, caps findings at 3 and recommendations at 2, and replaces the tool loop with a fill-in form. The engine stays exactly as correct — every number is still SQL.
- **Input budget.** In small-model mode the DECIDE request is kept under 6,500 estimated input tokens, so it fits free tiers that cap input per minute (Groq: 7,000). When it is larger, code trims what the model reads in a fixed order: redundant labels first, then the smaller members of each split, long quotes, decompositions no finding cites, unused metrics, and insight labels. It never changes a number. A request that still doesn't fit is not sent (`INPUT_TOO_LARGE`): the report keeps its verified findings and ships without recommendations, with the reason recorded.

## How models did

The latest results are on [Eval results](../../quality/results/). In short: no model passes the v0.1 bars yet. On Groq's free tier, `qwen/qwen3.8-27b` in small-model mode completed the smoke suite; the full suite needs more quota than the free tier gives in a day.
