# @agentic-analytics/cli

The `agentic-analytics` / `aa` command line (citty).

- **Status:** M0–M1 ship `aa doctor`; M4 adds `aa metrics`; M7 adds `aa run`; M10 adds `analyze`, `ask`, `explain`, `serve`, `mcp` and `jobs`. `aa eval` arrives with the eval runner in M11.
- **Spec:** docs/specs/interfaces.md §2

## Commands

| Command | Does |
|---|---|
| `aa metrics <paths…> [--yes] [--save file] [--metrics file] [--currency CODE] [--today date]` | Ingest → profile → draft metric definitions (configured model, else deterministic fallbacks) → validate → interactive review (accept/edit/drop; `--yes` keeps drafts as assumptions) → print each metric in plain words with its SQL and recent values. `--save` writes the definitions for reuse with `--metrics`. |
| `aa run <paths…> [--dir folder] [--today date] [--currency CODE] [--objective text] [--small-model] [--web] [--embedder hash\|<model>] [--log]` · `aa run --resume <folder>` | A full job in a job folder (`input/`, `job.duckdb`, `report.draft.json`) with the configured models: ingest → profile → metrics (kept as assumptions) → measure/detect/decompose → index documents → explain → decide → draft. Prints each stage as it starts and ends. If a stage fails (e.g. no model reachable), the completed stages are kept and it prints the `--resume` command to continue. Small-model mode also turns on from the planner's model profile. It writes the verified `report.json` and `report.html`. |
| `aa analyze <paths…> [--yes] [--objective text] [--web] [--small-model] [--out dir] [--open] [--currency CODE] [--today date] [--embedder hash]` | A full job through the job manager (the API and MCP run jobs the same way). It shows a live stage view and, without `--yes`, an interactive metric review: accept, edit (YAML) or drop each metric. An edit the validator refuses is reported and reviewed again. The report is copied to `<out>/agentic-analytics/report.json` and `report.html`, and a summary is printed. |
| `aa ask <jobId> "question"` | A follow-up answer: verified claims with numbers from the report's facts, and how many statements failed verification. |
| `aa explain <jobId> <factId>` | The number, its label, definition, SQL and parameters (or function and inputs) and input rows. |
| `aa serve [--port 8080] [--host 127.0.0.1]` | The HTTP API, with the viewer at `/` and MCP at `/mcp`. `API_TOKEN` turns on bearer auth. |
| `aa mcp` | The MCP server on stdio (Claude Desktop config: apps/mcp/README.md). |
| `aa jobs ls \| rm <id> \| resume <id>` | Lists, deletes or resumes jobs in `AA_JOBS_DIR` (default `data/jobs`). |
| `aa eval [--suite smoke\|full] [--model baseline\|configured\|<provider:model>] [--small-model] [--embedder hash]` | Runs the eval suite on the generated datasets. It writes `evals/results/*.json`, regenerates `evals/RESULTS.md`, and exits 1 if a bar fails (evals/runner/README.md). |
| `aa doctor` | Checks Node (≥22, required), DuckDB (required), Ollama, every configured OpenAI-compatible endpoint (keyed ones are probed), SearXNG and Docling; then calls the planner model with a one-line prompt if its provider is reachable. Prints a fix for each missing piece. Exits 1 only if a required check fails. |

## Public API

`runDoctor(deps)`, `formatReport(results)`, `exitCode(results)` and their types are exported from `src/index.ts`. `fetch`, env and the DuckDB probe are injected, so tests never touch the network.

## Example

```bash
bun run aa doctor
```
