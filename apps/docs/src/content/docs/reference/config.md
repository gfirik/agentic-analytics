---
title: Config
description: Environment variables and agentic-analytics.config.yaml.
---

Settings come from `.env` (gitignored; copy `.env.example`) and an optional `agentic-analytics.config.yaml`.

| Variable | Default | What |
|---|---|---|
| `PLANNER_MODEL`, `EXTRACTOR_MODEL`, `JUDGE_MODEL` | `ollama:qwen3.5:9b` | `ollama:<model>` or `openai-compatible:<endpoint>:<model>` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama |
| `GROQ_API_KEY`, `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `SAMBANOVA_API_KEY`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, `OPENROUTER_API_KEY`, `CEREBRAS_API_KEY` | — | free hosted endpoints (presets `groq`, `nvidia-nim`, `google-ai-studio`, `sambanova`, `cloudflare`, `openrouter`, `cerebras`) |
| `PLANNER_MODEL=a\|b` | — | the same model on several providers; the router falls back on rate limits and never switches models |
| `AA_MODEL_CACHE` | — | response cache directory (`aa eval` always caches in `evals/.cache`) |
| `AA_LOG_CALLS` | — | echo every model call to stderr (always logged to `data/logs/model-calls.jsonl`) |
| `EMBEDDING_MODEL` | `Xenova/bge-m3` | in-process embeddings (`--embedder hash` for the offline one) |
| `MODEL_TIMEOUT_MS` | `120000` | per request |
| `SEARXNG_URL` | `http://localhost:8888` | the web lane |
| `DOCLING_URL` | — | optional Docling for hard PDFs |
| `AA_JOBS_DIR` | `data/jobs` | where jobs live |
| `API_TOKEN` | — | bearer auth for the API and `/mcp` |
| `AA_ALLOWED_HOSTS` | — | host names the API may be reached by besides localhost |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHATS`, `AA_API_URL` | — | the Telegram demo |

The config file's JSON Schema: [config.schema.json](https://github.com/gfirik/agentic-analytics/blob/main/packages/schema/json/config.schema.json).
