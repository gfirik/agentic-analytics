// Public API of @agentic-analytics/eval-runner (docs/EVALS.md §2–§4).
export { baselineModel } from "./baseline.ts";
export { type EvalArgs, type EvalDeps, EvalRunError, evalCommand, type RealEvalArgs, realEvalCommand, resultsPage } from "./cli.ts";
export {
  loadRealAnswers,
  missingRealData,
  monthlyFacts,
  type RealCheckResult,
  type RealDatasetResult,
  type RealRunOptions,
  type RealSuiteResult,
  realResultsMarkdown,
  runRealSuite,
  scoreCheck,
  scoreRealReport,
} from "./real.ts";
export { type RunOptions, rescore, resultsMarkdown, runSuite, type Suite, type SuiteResult, suiteDatasets } from "./run.ts";
export {
  type Bar,
  canonicalMetrics,
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
