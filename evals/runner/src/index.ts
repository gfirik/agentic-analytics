// Public API of @agentic-analytics/eval-runner (docs/EVALS.md §2–§4).
export { baselineModel } from "./baseline.ts";
export { type EvalArgs, type EvalDeps, EvalRunError, evalCommand, resultsPage } from "./cli.ts";
export { type RunOptions, resultsMarkdown, runSuite, type Suite, type SuiteResult, suiteDatasets } from "./run.ts";
export {
  type Bar,
  type DatasetScore,
  matchesDistractor,
  matchesPlanted,
  type PlantedScore,
  type Subject,
  scoreReport,
  sliceOf,
  subjectOf,
  summarize,
} from "./score.ts";
