---
title: Quickstart
description: From a fresh clone to a verified report in about ten minutes.
sidebar:
  order: 2
---

## 1. Install

**Standalone binary (no Node or Bun):** download `aa-<os>-<arch>` and `SHA256SUMS` from a release, check it with `sha256sum -c SHA256SUMS --ignore-missing`, make it executable and run `./aa-linux-x64 doctor`. It bundles the engine and DuckDB. Two differences from the Node CLI: documents are indexed with the offline hash embedder (lexical, no 1 GB model download), and `aa serve` has no viewer at `/` (the API, MCP and `report.html` work). For semantic document search, use Docker or the Node CLI below.

**From source:**

You need **Node 22** and **[Bun](https://bun.sh)** (the package manager).

```bash
git clone https://github.com/gfirik/agentic-analytics && cd agentic-analytics
bun install
bun run aa doctor
```

`aa doctor` lists what this machine has: Node, DuckDB, any reachable model provider, SearXNG and Docling, with a fix for each missing piece.

## 2. A model

Pick one:

- **Local (Ollama):** `ollama pull qwen3.5:9b` — the default `PLANNER_MODEL`.
- **Free hosted endpoint (Groq, OpenRouter, Cerebras):** copy `.env.example` to `.env`, set the key and the model, for example

  ```bash
  GROQ_API_KEY=…            # free at console.groq.com
  PLANNER_MODEL=openai-compatible:groq:qwen/qwen3.8-27b
  EXTRACTOR_MODEL=openai-compatible:groq:qwen/qwen3.8-27b
  JUDGE_MODEL=openai-compatible:groq:qwen/qwen3.8-27b
  ```

  Keys live in `.env` (gitignored) and are never logged. Free tiers are rate-limited; use `--small-model`.

Run `bun run aa doctor` again: the "model call" line should say the planner replied.

## 3. Your first report

```bash
bun run aa analyze examples/coffee-roaster --yes --currency USD --today 2026-07-01 --small-model --embedder hash --open
```

- `--embedder hash` uses the offline embedder, so the first run doesn't download the 1 GB embedding model. Drop it later for better document search.
- `--yes` keeps the drafted metric definitions as flagged assumptions; without it you review each one (accept, edit, drop) before the analysis runs.
- The report lands in `./agentic-analytics/report.html` and `report.json`.

Walk through what it found: [Your first report](../first-report/).

## Docker

```bash
docker compose up            # API, viewer and MCP on http://127.0.0.1:8080
docker compose --profile web up -d searxng     # optional: the web lane
```

The port is published on 127.0.0.1 only. Set `API_TOKEN` in `.env` for bearer auth.

## No model at all?

Everything except EXPLAIN and DECIDE runs without a model, and the whole test suite runs with a scripted model: `bun run check`. To see the full pipeline offline, the scripted demo replays the example: `AA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster --yes --embedder hash`. It is a replay, not an analysis.
