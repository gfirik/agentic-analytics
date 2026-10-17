// Public API of @agentic-analytics/eval-runner (docs/EVALS.md §2–§4).
export { baselineModel } from "./baseline.ts";
export {
  type EvalArgs,
  type EvalDeps,
  EvalRunError,
  evalCommand,
  evalSlug,
  type RealEvalArgs,
  realEvalCommand,
  resultsPage,
  selectDatasets,
} from "./cli.ts";
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
export {
  mergeResults,
  mergeRoutes,
  type RouteUse,
  type RunOptions,
  rescore,
  resultsMarkdown,
  routeSummary,
  runSuite,
  type Suite,
  type SuiteResult,
  suiteDatasets,
} from "./run.ts";
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
