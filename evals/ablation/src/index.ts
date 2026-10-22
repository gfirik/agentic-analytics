// Public API of @agentic-analytics/eval-ablation (docs/specs/accuracy.md §8). Eval-only: nothing under packages/ or
// apps/ imports it (test/guard.test.ts).
export {
  type ArmRun,
  armAPrompt,
  MAX_STEPS,
  OUTPUT_RESERVE,
  parseAnswer,
  type QueryRun,
  RETRY_BUDGET,
  runArmA,
  runArmB,
  type Task,
  type TaskAnswer,
} from "./arms.ts";
export {
  type AblationArgs,
  type AblationDeps,
  type AblationFlags,
  ablationArgs,
  ablationCommand,
  ablationJobs,
  ablationSlug,
  DEFAULT_CONTEXT_TOKENS,
  scriptedClient,
} from "./cli.ts";
export { AblationError, type AblationErrorCode, SQL_ERROR_CODES } from "./errors.ts";
export { type AblationJob, type AblationSuite, COFFEE_GOLDEN, coffeeGoldenJob, periodOf, realGoldenJobs, smokeJobs } from "./jobs.ts";
export {
  armMetric,
  armSubject,
  type ChangesScore,
  changesMeasures,
  citationValid,
  goldenMeasures,
  type ItemScore,
  numericCells,
  plantedFound,
  type Rate,
  rate,
  type Support,
  scoreArmChanges,
  scoreArmItem,
  shareOf,
  supportTolerance,
  type UnsupportedCount,
  unsupportedNumbers,
} from "./measures.ts";
export { type ArmClientOptions, armModelClient, counting } from "./models.ts";
export { claimedNumbers, type Exclusion, type ProseNumber, proseNumbers, readings } from "./numbers.ts";
export {
  ARM_A_SYSTEM,
  ARM_B_SYSTEM,
  armAChanges,
  armAQuestion,
  armBChanges,
  armBQuestion,
  ChangesAnswer,
  QuestionAnswer,
  schemaText,
} from "./prompts.ts";
export { ablationLines, ablationMarkdown } from "./report.ts";
export {
  type AblationOptions,
  type AblationResult,
  ARMS,
  type Arm,
  type ArmJobResult,
  type ArmMeasures,
  type ArmTaskResult,
  type Comparison,
  cellSupport,
  runAblation,
} from "./run.ts";
export {
  buildSourceDatabase,
  classify,
  DEFAULT_LIMITS,
  LOCKED_OPTION_NAMES,
  type LockedOption,
  lockedOptions,
  type SandboxLimits,
  type SqlCell,
  type SqlResult,
  SqlSandbox,
  type TableInfo,
} from "./sandbox.ts";
export { previousMonth, scriptedArmA, scriptedArmB } from "./scripted.ts";
export { type ArmACut, armAText, readSources, type SourceDocument, type Sources, type TableCut } from "./sources.ts";
