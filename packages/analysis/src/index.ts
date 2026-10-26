export {
  type Baseline,
  type BaselineMethod,
  chooseBaseline,
  type Grain,
  type Materiality,
  MIN_PERIODS,
  materiality,
  noiseBand,
} from "./baselines.ts";
export {
  beyondKeys,
  type Contribution,
  contribution,
  contributionCalcs,
  type DiffCombination,
  diff,
  type EventGroup,
  type MemberChange,
  type Pvm,
  type PvmItem,
  pvm,
  type RateMix,
  type RateSegment,
  rateMix,
} from "./decompose.ts";
export { AnalysisError, type AnalysisErrorCode, FactBook, MAX_CITED_ROWS, type SeriesInfo } from "./factbook.ts";
export { type Amount, COST_BOUNDS, ImpactError, type ImpactRange, impactRange, SCENARIO_BOUNDS, type Scenario } from "./impact.ts";
export { type MarginEffect, type MarginItem, marginEffect, type PvmMargin, pvmMargin } from "./pvm-margin.ts";
export { type Flagged, flaggedPeriods, touchesFlagged } from "./quality-guard.ts";
export {
  CONFIDENCE_WEIGHT,
  impactShare,
  insightChange,
  MEMBER_MIN_SHARE,
  metricFamily,
  type RankContext,
  type Ranked,
  RECENCY_DECAY,
  REPRESENTATIVE_SHARE,
  rankInsights,
  TEMPLATE_PRIORITY,
  topForExplain,
} from "./rank.ts";
export {
  type AnalysisResult,
  type AnalyzeOptions,
  analyzeJob,
  persistFacts,
  type StoredDecomposition,
  type StoredInsight,
} from "./runner.ts";
export { MIN_SPIKE, SEASON_MAX, SEASON_SHARE, seasonalMatch, touchesSeason } from "./seasonal.ts";
export {
  type BenchmarkResult,
  benchmarkFacts,
  type DrillDownQuery,
  type DrillDownResult,
  drillDown,
  externalFacts,
  loadAnalysis,
  nextFactNumber,
  parseQuotedRange,
  type QuotedRange,
  readFacts,
  type ScenarioRequest,
  type ScenarioResult,
  scenarioFacts,
} from "./slice.ts";
export { hhi, MAD_SCALE, mad, mannKendall, mean, median, normalCdf, robustZ, sse, theilSen, twoProportionZ } from "./stats.ts";
export {
  anomalies,
  benchmarkGap,
  concentration,
  type Insight,
  mixShift,
  newLost,
  periodChange,
  type RatioCounts,
  ratioShift,
  type TemplateId,
  topContributors,
  trend,
  trendBreak,
} from "./templates.ts";
export {
  type Calc,
  type Confidence,
  calcRef,
  factRef,
  isOther,
  OTHER,
  type Point,
  point,
  type Ref,
  type Series,
  type Unit,
} from "./types.ts";
