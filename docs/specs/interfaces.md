# Spec: interfaces (the doors)

The core engine is shared: every door calls `@agentic-analytics/core`.

## 1. HTTP API (`apps/server`, Hono + zod-openapi)

| Method | Path | Does |
|---|---|---|
| POST | `/v1/jobs` | multipart `files[]` + `options` JSON (`web`, `period`, `grain`, `objective`, `auto_confirm`, `small_model`). Returns `202 { job_id, status }` |
| GET | `/v1/jobs/{id}` | status, current stage, progress %, timings, errors |
| GET | `/v1/jobs/{id}/events` | Server-Sent Events: `stage_started`, `stage_completed`, `progress`, `awaiting_confirmation`, `warning`, `done`, `failed` |
| GET | `/v1/jobs/{id}/metrics` | drafted metric YAML + plain-language rendering |
| POST | `/v1/jobs/{id}/metrics` | confirm or edit metrics (YAML body); resumes the job |
| GET | `/v1/jobs/{id}/report` | `report.json` (`Accept: application/json`) or `report.html` (`Accept: text/html` or `?format=html`) |
| POST | `/v1/jobs/{id}/ask` | `{ question }` → answer as `Claim[]` with facts and citations (same rules as reports) |
| GET | `/v1/jobs/{id}/facts/{factId}` | explain a number: SQL, params, input rows, definition |
| DELETE | `/v1/jobs/{id}` | delete job data |
| GET | `/v1/health` | engine, DuckDB, model, search and Docling availability |
| GET | `/openapi.json` | generated spec |

- **Auth:** none by default (localhost). An optional `API_TOKEN` env var enables bearer auth.
- **CORS:** off by default.

## 2. CLI (`apps/cli`, citty)

The binary is `agentic-analytics`, with the short alias `aa`.

| Command | Does |
|---|---|
| `aa analyze <path...> [--web] [--objective "..."] [--yes] [--small-model] [--out dir] [--open]` | Runs a full job locally (no server needed). Shows a live stage view and an interactive metric review, then writes the report into `<out>/agentic-analytics/`. |
| `aa ask <jobId> "question"` | Asks a follow-up question |
| `aa explain <jobId> <factId>` | Shows the computation behind a number |
| `aa serve [--port 8080]` | Starts the HTTP API |
| `aa mcp` | Starts the MCP server on stdio |
| `aa doctor` | Checks Node, DuckDB, Ollama models, SearXNG and Docling; prints fixes |
| `aa eval [--suite smoke\|full] [--model profile]` | Runs the eval suites |
| `aa jobs ls\|rm` | Manages jobs |

## 3. MCP server (`apps/mcp`, official SDK; stdio + streamable HTTP)

| Tool | Input | Output |
|---|---|---|
| `analyze_files` | file paths (local) or URLs to the API, options | `job_id` + status; with `wait: true`, returns the report summary |
| `get_report` | `job_id`, `format: summary\|json` | report |
| `confirm_metrics` | `job_id`, YAML | status |
| `ask_report` | `job_id`, question | claims with citations |
| `explain_number` | `job_id`, `fact_id` | computation |

Resources: `report://{job_id}` (JSON), `report-html://{job_id}`.

Tool descriptions must tell the calling model that numbers in results are verified and must be quoted, never recalculated.

## 4. Telegram demo (`apps/telegram`, grammY)

- **Flow:**
  1. The user sends files and an optional question.
  2. The bot calls the API with `auto_confirm=true` and streams stage updates by editing one message.
  3. It replies with the headline, the top 3 findings, the top 2 recommendations, `report.html` as a document, and a "metrics were assumed" notice.
- **Setup:** the token comes from `TELEGRAM_BOT_TOKEN` (free from @BotFather). Long polling is used by default, so no public URL is needed.

## 5. Viewer (`apps/viewer`, Vite + React)

- **Pages:** an upload page, a live job progress view (stages animated like the blueprint pipeline), a metric confirmation form, and an embedded report.
- **Hosting:** the viewer is served by `aa serve` at `/`.
