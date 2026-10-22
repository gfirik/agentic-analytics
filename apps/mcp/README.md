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

- `createMcpServer(manager, { today?, version?, roots?, maxBytes?, onError? })`: an `McpServer` over a `JobManager`.
  - `roots`: where `analyze_files` may read, `"any"` (the stdio default) or a list of folders (`[]`, none, is the HTTP default; set `AA_MCP_ROOTS`).
  - `maxBytes`: the most one `analyze_files` call reads (default 200 MB, the HTTP upload limit), with at most 500 files and 100 paths per call.
  - `onError`: gets unexpected errors; the caller sees only `INTERNAL: internal error`. `ManagerError`, `PathNotAllowedError` and `LimitError` keep their message.
- `serveStdio(manager, options?)`: connects it to stdio.
- `mcpHttpHandler(manager, options?)`: a stateless `(Request) => Promise<Response>` for streamable HTTP (`roots` defaults to none).
- `allowedPath(path, roots)`, `PathNotAllowedError`, `LimitError`.
- `collectFiles(path, out)`, `MAX_FILES`: the file walker `analyze_files` uses (symlinks skipped, at most 500 files in all, a `LimitError` past that); the CLI collects its paths with it too.

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
