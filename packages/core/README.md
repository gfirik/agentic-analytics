# @agentic-analytics/core

The job runner: the pipeline state machine with checkpoints, the event bus, structured logging, and the job manager every door uses.

- **Spec:** docs/ARCHITECTURE.md §2
- **Status:** built in M7; VERIFY since M9; RENDER, the metric-confirmation pause, the job manager and follow-ups since M10.

## Public API

- `runJob({ dir, jobId?, files?, options? }, deps)` runs a job in a folder: `input/`, `job.duckdb`, `metrics.drafted.json`, `report.draft.json`, `report.json` (verified) and `report.html`.
  - METRICS_DRAFT writes `metrics.drafted.json` (`DRAFTED_METRICS`) as soon as the draft is validated, before anything can fail on it: the drafts as proposed (`proposals`), `accepted`, `rejected` with reasons, `assumptions`, the `source` (model or fallback) and, when the fallback replaced an all-invalid model draft, that `model_draft`. A failed job keeps it, so a bad draft can be inspected.
  - Re-running the same folder resumes it. Completed stages are skipped, and the interrupted stage is reset and re-run.
  - `deps`: `{ model, embedder, reranker?, log?, engine?, now?, onEvent? }`.
  - `options`: `{ today, currency?, objective?, smallModel?, web?, autoConfirm?, budget? }`. With `autoConfirm: false` the job pauses at AWAIT_CONFIRM (an `awaiting_confirmation` event; `runJob` throws `JobError("AWAITING_CONFIRMATION")`) until `confirmJobMetrics(dir, yaml)` stores validated definitions (and any `roles:` block: every role posted becomes `confirmed`); the next run continues with them. `confirmJob(dir, yaml)` is the fuller form (a roles-only body revises the roles and re-drafts the metrics), `buildConfirmView(ws)` builds the screen and `confirmScreenLines(view)` prints it (semantics §5).
- `runPipeline(ws, bus, log, stages)` is the generic checkpointed stage runner. `stageRecords(ws)` lists stage statuses.
- `EventBus` validates events against the schema, numbers them, stores them in `events` and pushes them to subscribers. A resumed job continues the sequence.
- `createLogger(sink, { level, fields })`, `jsonLines(write)`, `silentLogger`: structured JSON logs, never `console.log`.
- `PipelineError` (`STAGE_FAILED`, with the stage), `StagePause`, and `JobError` (`NO_INPUT`, `INVALID_DRAFT`, `BAD_OPTIONS`, `AWAITING_CONFIRMATION`, `BAD_METRICS`, `UNKNOWN_ROLE`, `UNKNOWN_COLUMN`, `UNKNOWN_BUSINESS_MODEL`).
- `JobManager({ root, deps, model })`: jobs in `<root>/<jobId>/`, run one at a time.
  - `create`, `status`, `wait`, `subscribe` (history, then live), `events`, `metrics` (the confirm screen: metrics, column roles with evidence, table kinds, business model), `confirm` (confirms metrics and roles and resumes, or, with roles only, re-drafts and keeps waiting), `resume`, `report`, `reportHtml`, `ask`, `explain`, `delete`, `list`.
  - Typed `ManagerError` codes: `NOT_FOUND`, `BUSY`, `NOT_READY`, `BAD_REQUEST`. One confirm or resume at a time per job (a second is `BUSY`); `status.json` is replaced atomically, and an unreadable one lists as failed (`UNREADABLE_STATUS`). Upload names are cleaned by one rule (`file-name.ts`: base name, no control characters, at most 255 bytes) that `runJob` also enforces.
- `askJob(dir, question, model)`: the planner answers from the report and names the report claims each answer rests on. Code copies their citations, and the claims are verified with the report's passes.
- `explainFact(dir, factId)`: a number's SQL and parameters (or function and inputs), its definition and input rows.
- `@agentic-analytics/core/testing` exports `coffeePlanner()`: a scripted FakeModel for coffee-roaster-v1.

## Example

```ts
import { runJob } from "@agentic-analytics/core";
import { transformersEmbedder } from "@agentic-analytics/retrieval";

const out = await runJob(
  { dir: "data/jobs/demo", files, options: { today: "2026-07-01", currency: "USD" } },
  { model, embedder: transformersEmbedder() },
);
// out.report: the verified report; out.htmlPath: report.html; out.run: { ran, resumed, skipped }
```

Demo with the scripted model (no network): `bun run --filter @agentic-analytics/core job:coffee -- --dir data/jobs/coffee-demo`.
