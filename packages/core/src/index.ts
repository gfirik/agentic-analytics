// Public API of @agentic-analytics/core (docs/ARCHITECTURE.md §2): the job runner, the pipeline state machine
// with checkpoints, the event bus and structured logging.

export { buildConfirmView, type ConfirmOutcome, confirmJob, confirmJobMetrics } from "./confirm.ts";
export { confirmScreenLines, rolesScreenLines } from "./confirm-text.ts";
export { EventBus, type EventInput } from "./events.ts";
export { type Answer, askJob, explainFact, type FactExplanation, FollowUpError } from "./followup.ts";
export {
  DRAFTED_METRICS,
  type JobDeps,
  JobError,
  type JobOptions,
  type JobOutcome,
  type RunJobInput,
  runJob,
} from "./job.ts";
export { createLogger, jsonLines, type Level, type Logger, type LogRecord, silentLogger } from "./log.ts";
export { JobManager, type JobState, type JobStatus, ManagerError, type ManagerOptions } from "./manager.ts";
export {
  PipelineError,
  type RunResult,
  runPipeline,
  type StageContext,
  type StageDef,
  StagePause,
  type StageRecord,
  type StageStatus,
  stageRecords,
} from "./pipeline.ts";
