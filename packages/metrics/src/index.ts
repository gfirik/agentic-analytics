export { type Catalog, type CatalogColumn, type CatalogTable, loadCatalog } from "./catalog.ts";
export { type ColumnRef, metricColumns } from "./columns.ts";
export {
  compileMetric,
  compileMetricRows,
  type Grain,
  type MetricCompileCode,
  MetricCompileError,
  type MetricQuery,
  type MetricRow,
  periodExpr,
  type RowsQuery,
  runMetric,
} from "./compile.ts";
export { describeMetric } from "./describe.ts";
export { buildDigest, type Digest, type DigestColumn, type DigestOptions, type DigestTable, MAX_SAMPLES, maskSample } from "./digest.ts";
export {
  DRAFT_SYSTEM,
  type DraftRecord,
  type DraftResult,
  draftMetrics,
  draftPrompt,
  draftRecord,
  fallbackMetrics,
  METRIC_LIBRARY,
  type PriorDraft,
  redraftMetrics,
} from "./draft.ts";
export { metricsYaml, parseConfirmYaml, parseMetricsYaml, rolesYaml } from "./file.ts";
export { type KpiId, type KpiPack, type NotDrafted, type NotDraftedReason, type SalesBase, salesKpiPack } from "./kpi-pack.ts";
export { describeExpr, describeFilter, type MetricLangCode, MetricLangError, parseExpression, parseFilter } from "./lang.ts";
export {
  COST_METRIC,
  COSTED_REVENUE_METRIC,
  MARGIN_METRIC,
  MARGIN_PCT_METRIC,
  type MarginFn,
  type MarginTerms,
  marginDimensions,
  marginTerms,
  marginValue,
} from "./margin.ts";
export { definitionKey, type Merged, mergeMetricSets, sliceParents } from "./merge.ts";
export { saveMetricDefs } from "./persist.ts";
export { groupingColumns, MAX_GROUPING_VALUES, withGroupingDimensions } from "./profile-columns.ts";
export { type ReviewChoice, type ReviewIO, type ReviewOptions, type ReviewResult, reviewMetrics } from "./review.ts";
export { type Rejected, type ValidateOptions, type Validation, validateMetrics } from "./validate.ts";
