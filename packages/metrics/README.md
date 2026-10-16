# @agentic-analytics/metrics

The metric layer: draft metric definitions (model, else deterministic fallbacks), validate them in code, let the user confirm them, and compile each one to parameterized SQL. Every number the engine reports goes through this compiler, so each number is tied to a metric id and its SQL.

- **Spec:** docs/specs/metric-layer.md
- **Status:** M4.

## Public API

| Export | Does |
|---|---|
| `draftMetrics(summary, catalog, { model?, defaultCurrency? })` | Digest → extractor model proposal → validation. Falls back to `fallbackMetrics` when there is no model, the model fails, or nothing it proposes is valid. |
| `validateMetrics(proposals, catalog, opts)` | Accepts or rejects each proposal with reasons. Checks tables, columns, types per aggregation, the filter/expression grammar, dimensions, the time column, ratio terms, derived references (no cycles) and units. Fills currency from the column, the job default, or `XXX` (as an assumption). |
| `compileMetric(id, defs, catalog, { from, to, grain?, groupBy?, where? })`, `runMetric(ws, …)` | One SQL statement returning `period, [groups…], value`. Supports sum, count, count_distinct, avg, ratio (zero-guarded, ×100 for percent) and derived. Literals are always parameters. |
| `parseExpression`, `parseFilter` | The metric language: columns, numbers, `+ - * /`, `abs`, `coalesce`; filters with `= <> < <= > >=`, `IN`, `IS [NOT] NULL`, `AND/OR/NOT`. Anything else is rejected. |
| `buildDigest(summary)` | What a model sees: tables, columns, types and ≤ 5 samples per column. Customers, suppliers, people, emails and phones are masked. |
| `describeMetric(def)` | "Revenue = sum of amount where status is not refunded, per month, in USD" |
| `reviewMetrics(drafts, catalog, io?, { yes? })` | Accept, edit (YAML, re-validated) or drop each draft. `--yes` keeps new drafts as assumptions; confirmed ones stay confirmed. A final re-validation drops metrics whose inputs were dropped. |
| `metricsYaml`, `parseMetricsYaml`, `saveMetricDefs` | `agentic-analytics.metrics.yaml` for reuse, and the `metric_defs` workspace table. |

## Example

```bash
bun run aa metrics evals/datasets/coffee-roaster-v1/files --yes --currency USD --save agentic-analytics.metrics.yaml
bun run aa metrics evals/datasets/coffee-roaster-v1/files --metrics agentic-analytics.metrics.yaml --yes   # reuse
```
