// Public API of @agentic-analytics/core (docs/ARCHITECTURE.md §2): the job runner, the pipeline state machine
// with checkpoints, the event bus and structured logging.
export { EventBus, type EventInput } from "./events.ts";
export { type JobDeps, JobError, type JobOptions, type JobOutcome, type RunJobInput, runJob } from "./job.ts";
export { createLogger, jsonLines, type Level, type Logger, type LogRecord, silentLogger } from "./log.ts";
export {
  PipelineError,
  type RunResult,
  runPipeline,
  type StageContext,
  type StageDef,
  type StageRecord,
  type StageStatus,
  stageRecords,
} from "./pipeline.ts";
