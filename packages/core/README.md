# @agentic-analytics/core

The job runner: the pipeline state machine with checkpoints, the event bus and structured logging.

- **Spec:** docs/ARCHITECTURE.md §2
- **Status:** built in M7. The VERIFY stage arrives in M9 and RENDER in M10; until then they are recorded as skipped.

## Public API

- `runJob({ dir, jobId?, files?, options? }, deps)` runs a job in a folder: `input/`, `job.duckdb` and `report.draft.json`.
  - Re-running the same folder resumes it. Completed stages are skipped, and the interrupted stage is reset and re-run.
  - `deps`: `{ model, embedder, reranker?, log?, engine?, now?, onEvent? }`.
  - `options`: `{ today, currency?, objective?, smallModel?, web?, budget? }`.
- `runPipeline(ws, bus, log, stages)` is the generic checkpointed stage runner. `stageRecords(ws)` lists stage statuses.
- `EventBus` validates events against the schema, numbers them, stores them in `events` and pushes them to subscribers. A resumed job continues the sequence.
- `createLogger(sink, { level, fields })`, `jsonLines(write)`, `silentLogger`: structured JSON logs, never `console.log`.
- `PipelineError` (`STAGE_FAILED`, with the stage) and `JobError` (`NO_INPUT`, `INVALID_DRAFT`, `BAD_OPTIONS`).
- `@agentic-analytics/core/testing` exports `coffeePlanner()`: a scripted FakeModel for coffee-roaster-v1.

## Example

```ts
import { runJob } from "@agentic-analytics/core";
import { transformersEmbedder } from "@agentic-analytics/retrieval";

const out = await runJob(
  { dir: "data/jobs/demo", files, options: { today: "2026-07-01", currency: "USD" } },
  { model, embedder: transformersEmbedder() },
);
// out.report: the draft (report v1, unverified); out.run: { ran, resumed, skipped }
```

Demo with the scripted model (no network): `bun run --filter @agentic-analytics/core job:coffee -- --dir data/jobs/coffee-demo`.
