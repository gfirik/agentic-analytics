---
title: MCP (Claude Desktop, Cursor)
description: Let an AI agent analyze files and get verified numbers back.
sidebar:
  order: 3
---

`aa mcp` serves MCP over stdio; `aa serve` also serves it over streamable HTTP at `/mcp`.

| Tool | Input | Output |
|---|---|---|
| `analyze_files` | local file or folder paths; `objective`, `web`, `small_model`, `auto_confirm`, `currency`, `wait` | job id and status; with `wait: true`, the report summary (or the metrics to confirm) |
| `get_report` | `job_id`, `format: summary \| json` | the summary, or the full verified report |
| `confirm_metrics` | `job_id`, `yaml` | status; the job resumes |
| `ask_report` | `job_id`, `question` | verified claims with facts and citations |
| `explain_number` | `job_id`, `fact_id` | the computation behind a number |

Resources: `report://{job_id}` and `report-html://{job_id}`. Every tool description tells the calling model that numbers are verified and must be quoted, never recalculated.

## Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit Config), with your clone's path. Claude Desktop doesn't read `.env`, so the model settings go in `env`:

```json
{
  "mcpServers": {
    "agentic-analytics": {
      "command": "node",
      "args": ["/path/to/agentic-analytics/apps/cli/bin/aa.js", "mcp"],
      "env": {
        "AA_JOBS_DIR": "/path/to/agentic-analytics/data/jobs",
        "OLLAMA_BASE_URL": "http://localhost:11434",
        "PLANNER_MODEL": "ollama:qwen3.5:9b"
      }
    }
  }
}
```

Then: *"Analyze the files in /path/to/exports and tell me what changed."* A long job can outlast a client's request timeout; ask it to start with `wait: false` and poll `get_report`.

## Cursor and others

Any MCP client that launches a stdio server works the same way; clients that speak streamable HTTP can use `http://127.0.0.1:8080/mcp` while `aa serve` runs. Over HTTP, `analyze_files` reads local paths only inside the folders listed in `AA_MCP_ROOTS` (comma-separated, checked after resolving symlinks; none by default), so whoever can reach the port can't read the server's files: start the server with `AA_MCP_ROOTS=/path/to/exports aa serve`, or upload through `POST /v1/jobs`.
