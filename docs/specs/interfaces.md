# Spec: interfaces (the doors)

The core engine is shared: every door calls `@agentic-analytics/core`.

## 1. HTTP API (`apps/server`, Hono + zod-openapi)

| Method | Path | Does |
|---|---|---|
| POST | `/v1/jobs` | multipart `files[]` + `options` JSON (`web`, `objective`, `auto_confirm` (default true), `small_model`, `currency`, `today`). Returns `202 { job_id, status }`. `period` and `grain` overrides are not in v0.1: the period and grain come from the data, and unknown options are refused. |
| GET | `/v1/jobs` | all jobs with their status |
| GET | `/v1/jobs/{id}` | status, current stage, progress %, timings, errors |
| GET | `/v1/jobs/{id}/events` | Server-Sent Events: `stage_started`, `stage_completed`, `progress`, `awaiting_confirmation`, `warning`, `done`, `failed` |
| GET | `/v1/jobs/{id}/metrics` | the confirm screen: drafted metric YAML + plain-language rendering, and from M15 the column roles with their evidence, the table kinds, the business model and the vocabularies (semantics §5; the shape is the `ConfirmView` schema, in `/openapi.json`) |
| POST | `/v1/jobs/{id}/metrics` | confirm or edit metrics and roles (YAML body with an optional `roles:` block, metric-layer §1). With `metrics:` the job resumes; with roles only (or a business model) the metrics are drafted again from the new roles and the job keeps waiting (`202` with status `awaiting_confirmation`) |
| GET | `/v1/jobs/{id}/report` | `report.json` (`Accept: application/json`) or `report.html` (`Accept: text/html` or `?format=html`) |
| POST | `/v1/jobs/{id}/ask` | `{ question }` → answer as `Claim[]` with facts and citations (same rules as reports) |
| GET | `/v1/jobs/{id}/facts/{factId}` | explain a number: SQL, params, input rows, definition |
| POST | `/v1/jobs/{id}/resume` | continue a failed or interrupted job from its last completed stage |
| DELETE | `/v1/jobs/{id}` | delete job data |
| * | `/mcp` | the MCP server over streamable HTTP (§3) |
| GET | `/v1/health` | engine, DuckDB, model, search and Docling availability |
| GET | `/openapi.json` | generated spec |

- **Jobs:** every door goes through `JobManager` in `packages/core`. Jobs live in `AA_JOBS_DIR/<jobId>/` and run one at a time. Each job folder keeps `metrics.drafted.json`: the drafted metrics before validation and the validation result (metric-layer §2.6). While a job runs, its workspace is busy: metrics, ask, explain and delete answer `409 BUSY`. A confirm or resume holds the job from its check to the queue, so a second confirm or resume (or a read or delete of that job) in the meantime is `409 BUSY` and a job never runs twice; a confirm or resume during a metrics, ask or explain read is `409 BUSY` too. `status.json` is written to a temporary file and renamed over the old one, so a crash never leaves it half-written; a job whose `status.json` can't be parsed is listed as `failed` with error `UNREADABLE_STATUS` (resume or delete it), and the rest of the listing is unaffected.
- **Events:** the SSE stream sends the job's events so far, then live ones. It ends on a live `done`, `failed` or `awaiting_confirmation`. If the job's events can't be read (the job was deleted mid-request, or a confirm or resume holds the job for the moment it is queued again: code `BUSY`, and a client may reconnect), the stream sends one `failed` event with `seq: -1` (the only event not from the job's log; the event schema allows it) and the error code, and ends.
- **Errors:** `{ error: { code, message } }`, with 400 `BAD_REQUEST`, 404 `NOT_FOUND`, 409 `BUSY`/`NOT_READY`, and 401 `UNAUTHORIZED`.
- **Roles (M15):** a posted role must be in the vocabulary (semantics §1) and name a column that exists in that table. Otherwise the request is refused with 400 and the code `UNKNOWN_ROLE` or `UNKNOWN_COLUMN`, and nothing is applied. Roles not in the body stay as proposed, with `status: assumed`; every role in the body is confirmed. `role: none` drops a role. The same typed codes cover an unknown table (`UNKNOWN_COLUMN`) and an unknown business model (`UNKNOWN_BUSINESS_MODEL`). Metrics in the same request are not confirmed when a role is refused.
- **Ask:** the answer is claims that went through the report's verifier (agent-and-verifier §7). The planner names the report claims an answer rests on, and code copies their citations.
- **Auth:** none by default (localhost; the Docker port is published on 127.0.0.1). An optional `API_TOKEN` env var enables bearer auth on `/v1/jobs*` and `/mcp`. `/v1/health` and `/openapi.json` stay open, but without the token health reports only the engine and DuckDB (no provider, model or service details, and no model call). With no `API_TOKEN` configured (loopback only), health returns the full details. `aa serve` refuses to listen beyond loopback without `API_TOKEN` unless `--allow-no-auth` or `AA_ALLOW_NO_AUTH=1` is given: docker-compose sets `AA_ALLOW_NO_AUTH=1` because it publishes the port on 127.0.0.1 only, and a plain `docker run -p` needs `API_TOKEN`. The Host/Origin guard stops DNS rebinding in browsers; it is not access control. An unexpected error returns a generic 500 message; the details go to the server log. Refusals keep their status (413 for an upload over the limit, 415, 400). `report.html` is served with `Content-Security-Policy: sandbox allow-scripts`, since it holds untrusted text on the origin where the viewer keeps its token.
- **Hosts:** every route refuses (403 `FORBIDDEN_HOST`) a request whose `Host` or `Origin` names a host other than localhost, 127.0.0.1, ::1, the `--host` given, or `AA_ALLOWED_HOSTS`. A web page that DNS-rebinds its name to 127.0.0.1 therefore can't read jobs or call `/mcp`, token or not.
- **Uploads:** file names keep their base name only, without control characters (NUL included), and at most 255 UTF-8 bytes, shortened before the extension. `.`, `..` and empty names become `file-<n>`, and a duplicate gets ` (2)`, so no upload overwrites another. A job that can't be written is removed again, so no folder without `status.json` is left behind. `runJob` refuses any name this rule would change (`BAD_INPUT`). Option `today` must be a calendar date (`2026-02-30` is a 400), as must `--today` on the CLI. MCP `analyze_files` skips symlinks and reads at most 500 files.
- **Defaults:** option defaults (small-model mode from the planner's model profile) are applied by the job manager, so every door runs the same job for the same files.
- **CORS:** off by default.

## 2. CLI (`apps/cli`, citty)

The binary is `agentic-analytics`, with the short alias `aa`.

| Command | Does |
|---|---|
| `aa analyze <path...> [--web] [--objective "..."] [--yes] [--small-model] [--out dir] [--open]` | Runs a full job locally (no server needed). Shows a live stage view and an interactive review of the column roles and metrics on one screen (metric-layer §3): one question for all roles (accept, edit one by one, or leave as assumptions), one for the business model, then each metric, then writes the report into `<out>/agentic-analytics/`. `--yes` keeps every role and metric as an assumption. |
| `aa ask <jobId> "question"` | Asks a follow-up question |
| `aa explain <jobId> <factId>` | Shows the computation behind a number |
| `aa serve [--port 8080]` | Starts the HTTP API |
| `aa mcp` | Starts the MCP server on stdio |
| `aa doctor` | Checks Node, DuckDB, model providers, SearXNG and Docling; calls each role's model (planner, extractor, judge) once; `--models` lists every reachable provider's model ids; prints fixes |
| `aa eval [--suite smoke\|full\|real] [--model baseline\|configured\|<provider:model>]` | Runs the eval suites and updates `evals/RESULTS.md` |
| `aa eval --suite roles [--only generated\|real\|<id,…>]` | M15: scores the role detector against `evals/roles/labels.yaml` (accuracy §11); no model (`bun run eval:roles`); the model tie-break's own measurement comes with the nightly slot |
| `aa eval --suite smoke\|full [--label "<name>"] [--note "<text>"] [--only <id,…> --results-dir <dir>]` | `--label` names the run's model row and results file (a self-hosted run, e.g. the Kaggle vLLM notebook); `--note` is shown above its table; `--only` runs some datasets (a chunk; its `--results-dir` must be outside `evals/results`), joined with `bun run eval:merge` (EVALS.md §3) |
| `aa eval --suite real --answers <dir> [--data <dir>] [--results-dir <dir>]` | The real-data checks on your own files and answer files; results to `./eval-results` by default (EVALS.md §3) |
| `aa jobs ls\|rm\|resume` | Manages jobs |
| `aa run <path...>` / `aa run --resume <dir>` | A job in an explicit folder, without the job manager (M7; kept for scripts) |

## 3. MCP server (`apps/mcp`, official SDK; stdio + streamable HTTP)

| Tool | Input | Output |
|---|---|---|
| `analyze_files` | local file or folder paths, options | `job_id` + status; with `wait: true`, returns the report summary (or the metrics to confirm) |
| `get_report` | `job_id`, `format: summary\|json` | report |
| `confirm_metrics` | `job_id`, YAML (metrics, and from M15 an optional `roles:` block; validated as in §1) | status; for a roles-only body, the new screen (the job keeps waiting) |
| `ask_report` | `job_id`, question | claims with citations |
| `explain_number` | `job_id`, `fact_id` | computation |

Resources: `report://{job_id}` (JSON), `report-html://{job_id}`.

Tool descriptions must tell the calling model that numbers in results are verified and must be quoted, never recalculated.

The MCP server runs in the engine's process, either through `aa mcp` (stdio) or at `/mcp` in `aa serve` (stateless streamable HTTP). Over stdio it reads local paths. Over HTTP, `analyze_files` reads only inside the folders in `AA_MCP_ROOTS` (comma-separated; checked after resolving symlinks), and none by default: an HTTP caller uploads through `POST /v1/jobs` instead. One call reads at most 100 paths, 500 files and 200 MB. Only typed errors (not found, busy, path not allowed, limits) carry their message to the caller; others are logged and answered with a generic message. Uploading by URL to a remote API is not in v0.1; a remote client uses the HTTP API instead.

## 4. Telegram demo (`apps/telegram`, grammY)

- **Flow:**
  1. The user sends files, then a question (used as the objective) or `/analyze`; a caption on a file starts the job with the caption as the question.
  2. The bot calls the API with `auto_confirm=true` and streams stage updates by editing one message.
  3. It replies with the headline, the top 3 findings, the top 2 recommendations, `report.html` as a document, and a "metrics and column roles were assumed" notice.
- **Setup:** the token comes from `TELEGRAM_BOT_TOKEN` (free from @BotFather). Long polling is used by default, so no public URL is needed.

## 5. Viewer (`apps/viewer`, Vite + React)

- **Pages:** an upload page, a live job progress view (stages animated like the blueprint pipeline), a confirmation form for the metrics and column roles (one form, M15): a role table with a select per role and its evidence, the table kinds, the business model, "Update the drafts" (a roles-only request, then the new metrics are shown) and "Confirm and continue", and an embedded report.
- **Hosting:** the viewer is built with Vite into `apps/viewer/dist` and served by `aa serve` at `/` (client routes fall back to `index.html`). Without a build, `/` says how to build it.
