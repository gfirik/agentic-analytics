# Spec: interfaces (the doors)

The core engine is shared: every door calls `@agentic-analytics/core`.

## 1. HTTP API (`apps/server`, Hono + zod-openapi)

| Method | Path | Does |
|---|---|---|
| POST | `/v1/jobs` | multipart `files[]` + `options` JSON (`web`, `objective`, `auto_confirm` (default true), `small_model`, `currency`, `today`). Returns `202 { job_id, status }`. `period` and `grain` overrides are not in v0.1: the period and grain come from the data, and unknown options are refused. |
| GET | `/v1/jobs` | all jobs with their status |
| GET | `/v1/jobs/{id}` | status, current stage, progress %, timings, errors |
| GET | `/v1/jobs/{id}/events` | Server-Sent Events: `stage_started`, `stage_completed`, `progress`, `awaiting_confirmation`, `warning`, `done`, `failed` |
| GET | `/v1/jobs/{id}/metrics` | drafted metric YAML + plain-language rendering |
| POST | `/v1/jobs/{id}/metrics` | confirm or edit metrics (YAML body); resumes the job |
| GET | `/v1/jobs/{id}/report` | `report.json` (`Accept: application/json`) or `report.html` (`Accept: text/html` or `?format=html`) |
| POST | `/v1/jobs/{id}/ask` | `{ question }` → answer as `Claim[]` with facts and citations (same rules as reports) |
| GET | `/v1/jobs/{id}/facts/{factId}` | explain a number: SQL, params, input rows, definition |
| POST | `/v1/jobs/{id}/resume` | continue a failed or interrupted job from its last completed stage |
| DELETE | `/v1/jobs/{id}` | delete job data |
| * | `/mcp` | the MCP server over streamable HTTP (§3) |
| GET | `/v1/health` | engine, DuckDB, model, search and Docling availability |
| GET | `/openapi.json` | generated spec |

- **Jobs:** every door goes through `JobManager` in `packages/core`. Jobs live in `AA_JOBS_DIR/<jobId>/` and run one at a time. Each job folder keeps `metrics.drafted.json`: the drafted metrics before validation and the validation result (metric-layer §2.6). While a job runs, its workspace is busy: metrics, ask, explain and delete answer `409 BUSY`.
- **Events:** the SSE stream sends the job's events so far, then live ones. It ends on a live `done`, `failed` or `awaiting_confirmation`.
- **Errors:** `{ error: { code, message } }`, with 400 `BAD_REQUEST`, 404 `NOT_FOUND`, 409 `BUSY`/`NOT_READY`, and 401 `UNAUTHORIZED`.
- **Ask:** the answer is claims that went through the report's verifier (agent-and-verifier §7). The planner names the report claims an answer rests on, and code copies their citations.
- **Auth:** none by default (localhost; the Docker port is published on 127.0.0.1). An optional `API_TOKEN` env var enables bearer auth on `/v1/jobs*` and `/mcp`. `/v1/health` and `/openapi.json` stay open, but without the token health reports only the engine and DuckDB (no provider, model or service details, and no model call). With no `API_TOKEN` configured (loopback only), health returns the full details. `aa serve` refuses to listen beyond loopback without `API_TOKEN` unless `--allow-no-auth` or `AA_ALLOW_NO_AUTH=1` is given: docker-compose sets `AA_ALLOW_NO_AUTH=1` because it publishes the port on 127.0.0.1 only, and a plain `docker run -p` needs `API_TOKEN`. The Host/Origin guard stops DNS rebinding in browsers; it is not access control. An unexpected error returns a generic 500 message; the details go to the server log.
- **Hosts:** every route refuses (403 `FORBIDDEN_HOST`) a request whose `Host` or `Origin` names a host other than localhost, 127.0.0.1, ::1, the `--host` given, or `AA_ALLOWED_HOSTS`. A web page that DNS-rebinds its name to 127.0.0.1 therefore can't read jobs or call `/mcp`, token or not.
- **Uploads:** file names keep their base name only. `.`, `..` and empty names become `file-<n>`, and a duplicate gets ` (2)`, so no upload overwrites another. MCP `analyze_files` skips symlinks and reads at most 500 files.
- **Defaults:** option defaults (small-model mode from the planner's model profile) are applied by the job manager, so every door runs the same job for the same files.
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
| `aa doctor` | Checks Node, DuckDB, model providers, SearXNG and Docling; calls each role's model (planner, extractor, judge) once; `--models` lists every reachable provider's model ids; prints fixes |
| `aa eval [--suite smoke\|full\|real] [--model baseline\|configured\|<provider:model>]` | Runs the eval suites and updates `evals/RESULTS.md` |
| `aa eval --suite real --answers <dir> [--data <dir>] [--results-dir <dir>]` | The real-data checks on your own files and answer files; results to `./eval-results` by default (EVALS.md §3) |
| `aa jobs ls\|rm\|resume` | Manages jobs |
| `aa run <path...>` / `aa run --resume <dir>` | A job in an explicit folder, without the job manager (M7; kept for scripts) |

## 3. MCP server (`apps/mcp`, official SDK; stdio + streamable HTTP)

| Tool | Input | Output |
|---|---|---|
| `analyze_files` | local file or folder paths, options | `job_id` + status; with `wait: true`, returns the report summary (or the metrics to confirm) |
| `get_report` | `job_id`, `format: summary\|json` | report |
| `confirm_metrics` | `job_id`, YAML | status |
| `ask_report` | `job_id`, question | claims with citations |
| `explain_number` | `job_id`, `fact_id` | computation |

Resources: `report://{job_id}` (JSON), `report-html://{job_id}`.

Tool descriptions must tell the calling model that numbers in results are verified and must be quoted, never recalculated.

The MCP server runs in the engine's process, either through `aa mcp` (stdio) or at `/mcp` in `aa serve` (stateless streamable HTTP). Over stdio it reads local paths. Over HTTP, `analyze_files` reads only inside the folders in `AA_MCP_ROOTS` (comma-separated; checked after resolving symlinks), and none by default: an HTTP caller uploads through `POST /v1/jobs` instead. Uploading by URL to a remote API is not in v0.1; a remote client uses the HTTP API instead.

## 4. Telegram demo (`apps/telegram`, grammY)

- **Flow:**
  1. The user sends files, then a question (used as the objective) or `/analyze`; a caption on a file starts the job with the caption as the question.
  2. The bot calls the API with `auto_confirm=true` and streams stage updates by editing one message.
  3. It replies with the headline, the top 3 findings, the top 2 recommendations, `report.html` as a document, and a "metrics were assumed" notice.
- **Setup:** the token comes from `TELEGRAM_BOT_TOKEN` (free from @BotFather). Long polling is used by default, so no public URL is needed.

## 5. Viewer (`apps/viewer`, Vite + React)

- **Pages:** an upload page, a live job progress view (stages animated like the blueprint pipeline), a metric confirmation form, and an embedded report.
- **Hosting:** the viewer is built with Vite into `apps/viewer/dist` and served by `aa serve` at `/` (client routes fall back to `index.html`). Without a build, `/` says how to build it.
