# @agentic-analytics/mcp

The MCP server over the engine: stdio (`aa mcp`) and streamable HTTP (`aa serve`, at `/mcp`).

- **Status:** built in M10.
- **Spec:** docs/specs/interfaces.md §3

## Tools and resources

| Tool | Input | Output |
|---|---|---|
| `analyze_files` | `paths` (local files or folders), `objective?`, `web?`, `small_model?`, `auto_confirm?` (default true), `currency?`, `wait?` | job id and status; with `wait: true`, the report summary (or the metrics to confirm) |
| `get_report` | `job_id`, `format: summary \| json` | the summary text, or the full verified `report.json` |
| `confirm_metrics` | `job_id`, `yaml` | status (the job resumes; invalid definitions are refused with reasons) |
| `ask_report` | `job_id`, `question` | verified claims with facts and citations; dropped claims with reasons |
| `explain_number` | `job_id`, `fact_id` | SQL and parameters (or function and inputs), definition, input rows |

Resources: `report://{job_id}` (JSON) and `report-html://{job_id}`. Every tool description tells the calling model that numbers are verified and must be quoted, never recalculated.

## Public API

- `createMcpServer(manager, { today?, version? })`: an `McpServer` over a `JobManager`.
- `serveStdio(manager)`: connects it to stdio.
- `mcpHttpHandler(manager)`: a stateless `(Request) => Promise<Response>` for streamable HTTP.

## Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), with your clone's path. The model settings are the same environment variables as `.env` (see `.env.example`). Claude Desktop does not read `.env`, so put them in `env`.

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

Then ask Claude: "Analyze the files in /path/to/my/exports and tell me what changed." It calls `analyze_files` with `wait: true`, then `ask_report` or `explain_number` for follow-ups.

## Example

```bash
bun run aa mcp            # stdio; logs go to stderr
bun run aa serve          # HTTP at http://127.0.0.1:8080/mcp
```
