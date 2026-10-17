---
title: CLI
description: Every `aa` command.
sidebar:
  order: 1
---

The binary is `agentic-analytics`, alias `aa` (`bun run aa …` from a clone).

| Command | Does |
|---|---|
| `aa analyze <paths…> [--yes] [--objective "…"] [--web] [--small-model] [--out dir] [--open] [--currency CODE] [--embedder hash]` | A full job with a live stage view and, without `--yes`, an interactive review of the drafted metrics (accept, edit as YAML, drop). Writes `<out>/agentic-analytics/report.json` and `report.html`. |
| `aa ask <job> "question"` | A follow-up answer: claims that passed the verifier, with numbers from the report's facts. |
| `aa explain <job> <fact>` | The computation behind a number: SQL and parameters (or function and inputs), its definition, and the input rows. |
| `aa serve [--port 8080] [--host 127.0.0.1] [--allow-no-auth]` | The HTTP API, with the viewer at `/` and MCP at `/mcp`. A non-loopback `--host` needs `API_TOKEN` (or `--allow-no-auth` behind a proxy or a localhost-only port mapping). `AA_MCP_ROOTS` lists the folders MCP over HTTP may read. |
| `aa mcp` | The MCP server on stdio. |
| `aa jobs ls \| rm <id> \| resume <id>` | Manage jobs in `AA_JOBS_DIR` (default `data/jobs`). |
| `aa eval [--suite smoke\|full] [--model …]` | The eval suite; updates `evals/RESULTS.md`. |
| `aa doctor` | What this machine has, with a fix for each missing piece. |
| `aa metrics <paths…>` | Draft and review metric definitions only; `--save` writes them for reuse. |
| `aa run <paths…> --dir <folder>` / `--resume <folder>` | A job in an explicit folder, for scripts. |

Configuration comes from `.env` and `agentic-analytics.config.yaml`: see [Config](../../reference/config/).
