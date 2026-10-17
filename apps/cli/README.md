# @agentic-analytics/cli

The `agentic-analytics` / `aa` command line (citty).

- **Status:** M0–M1 ship `aa doctor`; M4 adds `aa metrics`; M7 adds `aa run`; M10 adds `analyze`, `ask`, `explain`, `serve`, `mcp` and `jobs`. `aa eval` arrives with the eval runner in M11.
- **Spec:** docs/specs/interfaces.md §2

## Commands

| Command | Does |
|---|---|
| `aa metrics <paths…> [--yes] [--save file] [--metrics file] [--currency CODE] [--today date]` | Ingest → profile → draft metric definitions (configured model, else deterministic fallbacks) → validate → interactive review (accept/edit/drop; `--yes` keeps drafts as assumptions) → print each metric in plain words with its SQL and recent values. `--save` writes the definitions for reuse with `--metrics`. |
| `aa run <paths…> [--dir folder] [--today date] [--currency CODE] [--objective text] [--small-model] [--web] [--embedder hash\|<model>] [--log]` · `aa run --resume <folder>` | A full job in a job folder (`input/`, `job.duckdb`, `metrics.drafted.json`, `report.draft.json`) with the configured models: ingest → profile → metrics (kept as assumptions) → measure/detect/decompose → index documents → explain → decide → draft. Prints each stage as it starts and ends. If a stage fails (e.g. no model reachable), the completed stages are kept and it prints the `--resume` command to continue. Small-model mode also turns on from the planner's model profile. It writes the verified `report.json` and `report.html`. |
| `aa analyze <paths…> [--yes] [--objective text] [--web] [--small-model] [--out dir] [--open] [--currency CODE] [--today date] [--embedder hash]` | A full job through the job manager (the API and MCP run jobs the same way). It shows a live stage view and, without `--yes`, an interactive metric review: accept, edit (YAML) or drop each metric. An edit the validator refuses is reported and reviewed again. The report is copied to `<out>/agentic-analytics/report.json` and `report.html`, and a summary is printed. |
| `aa ask <jobId> "question"` | A follow-up answer: verified claims with numbers from the report's facts, and how many statements failed verification. |
| `aa explain <jobId> <factId>` | The number, its label, definition, SQL and parameters (or function and inputs) and input rows. |
| `aa serve [--port 8080] [--host 127.0.0.1]` | The HTTP API, with the viewer at `/` and MCP at `/mcp`. `API_TOKEN` turns on bearer auth; a non-loopback `--host` needs it (or `--allow-no-auth` / `AA_ALLOW_NO_AUTH=1` behind a proxy or a 127.0.0.1 port mapping). `AA_MCP_ROOTS` lists the folders MCP over HTTP may read (none by default). |
| `aa mcp` | The MCP server on stdio (Claude Desktop config: apps/mcp/README.md). |
| `aa jobs ls \| rm <id> \| resume <id>` | Lists, deletes or resumes jobs in `AA_JOBS_DIR` (default `data/jobs`). |
| `aa eval [--suite smoke\|full] [--model baseline\|configured\|<provider:model>] [--small-model] [--embedder hash] [--keep-reports dir] [--results-dir dir]` | Runs the eval suite on the generated datasets. `--keep-reports dir` keeps each report and each job's drafted metrics (`<dataset>.metrics.drafted.json`, also for a failed job). It writes `evals/results/*.json` and regenerates `evals/RESULTS.md` in a checkout; with `--results-dir dir` (and by default in the standalone binary, `./eval-results`) both go into that folder, and exits 1 if a bar fails (evals/runner/README.md). |
| `aa eval --suite real --answers <dir> [--data <dir>] [--model …] [--results-dir dir]` | The real-data checks on your own files: one answer file per dataset in `<dir>` (a dataset that isn't one of the public ones needs a `title`), the files they name in `--data` (default: the answers folder). With `--answers`, results and their RESULTS.md go to `./eval-results` unless `--results-dir` says otherwise, never to `evals/results`. Exits 1 if a check fails. |
| `aa doctor` | Checks Node (≥22, required), DuckDB (required), Ollama, every configured OpenAI-compatible endpoint (keyed ones are probed), SearXNG and Docling; then calls the planner model with a one-line prompt if its provider is reachable. Prints a fix for each missing piece. Exits 1 only if a required check fails. |

The metric review (`aa analyze` and `aa metrics` without `--yes`) reads its answers line by line from stdin, so answers piped in ahead of the questions are read in order; when the input runs out before every metric is answered, it stops with exit 1 and a message instead of asking again (`ReviewEndedError`, code `REVIEW_ENDED`, `src/prompt.ts`).

## Public API

`runDoctor(deps)`, `formatReport(results)`, `exitCode(results)` and their types are exported from `src/index.ts`. `fetch`, env and the DuckDB probe are injected, so tests never touch the network.

## Example

```bash
bun run aa doctor
```

## Standalone binary

`bun scripts/build-binary.ts` builds `dist/bin/aa-<os>-<arch>[.exe]` and its `.sha256` for the machine it runs on (`bun build --compile`); release tags build all four targets on native runners (`.github/workflows/binaries.yml`). DuckDB's addon needs its shared library, which the binary embeds and writes once to `<cache>/agentic-analytics/native/duckdb-<node-api version>-<platform>-<arch>/` before loading it (`src/native-lib.ts`). The binary sets `AA_STANDALONE=1`, and `src/standalone.ts` holds what that changes: the hash embedder by default (no ONNX), no viewer at `/`, `aa eval` results in `./eval-results`, and doctor naming the Bun runtime. See docs/DECISIONS.md D16.
