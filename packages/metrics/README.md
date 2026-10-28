# @agentic-analytics/metrics

The metric layer: draft metric definitions (model, else deterministic fallbacks), validate them in code, let the user confirm them, and compile each one to parameterized SQL. Every number the engine reports goes through this compiler, so each number is tied to a metric id and its SQL.

- **Spec:** docs/specs/metric-layer.md
- **Status:** M4.

## Public API

| Export | Does |
|---|---|
| `draftMetrics(summary, catalog, { model?, defaultCurrency? })` | Digest → extractor model proposal → validation. The KPI pack is always drafted first and merged with the model's draft by definition; the fallback's channel slices replace the model's draft when there is no model, the model fails, or nothing it proposes is valid. Returns the model's `proposals`, the merged `validation`, `notDrafted`, `merged` and the model's rejected `modelDraft` when the fallback replaced it. |
| `marginTerms(def, defs)`, `marginValue(fn, revenue, cost)` | The fixed shape of the margin metrics: which two metrics a margin definition is built from, and its value as a function of them (read by the fact book and the verifier; nothing here is SQL). |
| `draftRecord(draft)` | The JSON a job saves as `metrics.drafted.json` (spec §2.6): `source`, `note`, `proposals`, `accepted`, `rejected` with reasons, `assumptions`, `model_draft`. A debug artifact with no stable schema. |
| `validateMetrics(proposals, catalog, opts)` | Accepts or rejects each proposal with reasons. Checks tables, columns, types per aggregation, the filter/expression grammar, dimensions, the time column, ratio terms, derived references (no cycles) and units. A ratio of a quantity to itself (same metric, or same table + expression + filters) is rejected: `ratio "x" divides "revenue" by itself (always 1)`. So is a derived `revenue / revenue`. Fills currency from the column, the job default, or `XXX` (as an assumption). |
| `compileMetric(id, defs, catalog, { from, to, grain?, groupBy?, where? })`, `runMetric(ws, …)` | One SQL statement returning `period, [groups…], value`. Supports sum, count, count_distinct, avg, ratio (zero-guarded, ×100 for percent) and derived. Literals are always parameters. Joined CTEs get one alias per side (`j0`, `j1`, …), so a CTE joined to itself is valid SQL. |
| `compileMetricRows(id, defs, catalog, { period, through?, grain?, where?, limit? })` | The citations behind one metric value: for every table the metric reads (following ratio terms and derived references), a `rows` query for the `_row` numbers in the period that pass the metric's filters (and `where`), and a `count` query. The verifier and the fact book build row citations from it. |
| `parseExpression`, `parseFilter` | The metric language: columns, numbers, `+ - * /`, `abs`, `coalesce`; filters with `= <> < <= > >=`, `IN`, `IS [NOT] NULL`, `AND/OR/NOT`. Anything else is rejected. |
| `groupingColumns(table)`, `withGroupingDimensions(def, summary)`, `MAX_GROUPING_VALUES` | The columns a change can be explained by (categories with 2 to `MAX_GROUPING_VALUES` = 2000 values, not a refund status, not id-like, not flagged by the screen), and a drafted sum, count or average given every one of its table's grouping columns (except one its filter pins to a single value). |
| `draftPrompt(digest)`, `DRAFT_SYSTEM`, `METRIC_LIBRARY` | The extractor's metric-draft prompt and system text, and the common business metrics that guide it (spec §2.2). |
| `buildDigest(summary)` | What a model sees: tables, columns, types and ≤ 5 samples per column. Customers, suppliers, people, emails and phones are masked. |
| `maskSample(value, label, index, type?)`, `MAX_SAMPLES` | The digest's masking of one sample value (customers, suppliers, people, emails, phones), and its 5 samples per column. |
| `describeMetric(def)` | "Revenue = sum of amount where status is not refunded, per month, in USD" |
| `reviewMetrics(drafts, catalog, io?, { yes? })` | Accept, edit (YAML, re-validated) or drop each draft. `--yes` keeps new drafts as assumptions; confirmed ones stay confirmed. A final re-validation drops metrics whose inputs were dropped. Only a parse error counts as invalid YAML: an error from `io.choose` or `io.edit` (for example, the terminal's input ended) rejects the review unchanged. |
| `redraftMetrics(summary, catalog, prior, opts)` | The metrics drafted again after a role change (semantics §5): a model's draft is validated as proposed, the deterministic drafts are rebuilt from the roles; no model call. `metricColumns(def, defs)` lists the columns a metric reads (role assumptions use it). `parseConfirmYaml` / `rolesYaml` read and write a confirmation body with or without `metrics:`. |
| `metricsYaml`, `parseMetricsYaml`, `saveMetricDefs` | `agentic-analytics.metrics.yaml` for reuse, and the `metric_defs` workspace table (YAML, SQL and its params, status). |
| `salesKpiPack(summary)` | The sales KPI pack (analysis-library §8.1), drafted by code from the roles: `revenue`, `orders`, `units`, `aov`, `customers`, `new_customers`, `returning_customers`, `refund_rate`, `cancellation_rate`, `discount_rate`, and with a cost role `cost`, `gross_margin` (derived: revenue − cost) and `gross_margin_pct` (§9), each only when its roles exist. Returns `defs`, `notDrafted` (each missing KPI and why) and `assumptions`. |
| `mergeMetricSets(sets, catalog)`, `definitionKey`, `sliceParents(defs)` | Merging by definition (same type, table, expression, filters and time column = one metric; earlier sets win), and the slices among a set by definition, which ranking uses to group families. |
| `fallbackMetrics(summary)` | The deterministic drafts on their own (spec §2.4): the KPI pack and a `<member>_revenue` slice for each member of a channel-role category with 2–5 values. Roles are the profile's (`summary.semantics`), not header names, and a summary with no roles drafts nothing. |
| `loadCatalog(ws)` | Tables, typed columns and date columns of a workspace, as the metric layer sees them. A table with no date column but a year (and month) column (`profile_period_parts`, semantics §2.1) gets the stand-in time column `PERIOD_COLUMN` (`_period`), which the compiler reads as the first day of the month (`timeExpr`). Drafting does not yet write metrics for such a table: its definitions come from a file or the confirm screen. |
| `periodExpr(column, grain)` | Period key SQL at a grain (`%Y-%m`, ISO week `%G-W%V`, quarter, …). |
| `MetricLangError`, `MetricCompileError` | Typed errors with a `code` (`TOKEN`/`PARSE`/`FUNCTION`; `UNKNOWN_METRIC`/`UNKNOWN_TABLE`/`UNKNOWN_COLUMN`/`NOT_NUMERIC`/`NO_TIME_COLUMN`/`UNSUPPORTED_TYPE`). |

## Example

```bash
bun run aa metrics evals/datasets/coffee-roaster-v1/files --yes --currency USD --save agentic-analytics.metrics.yaml
bun run aa metrics evals/datasets/coffee-roaster-v1/files --metrics agentic-analytics.metrics.yaml --yes   # reuse
```
