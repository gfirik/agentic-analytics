# @agentic-analytics/analysis

The engine's deterministic numbers core. It measures metrics, detects changes, decomposes them into drivers, computes impact ranges and ranks findings. Everything is SQL (through the metric compiler) or a pure TypeScript function with a hand-computed test. The model never replaces any of it (DECISIONS D9).

- **Spec:** docs/specs/analysis-library.md
- **Status:** M5, extended through M14a (seasonality, rate and member stories, the beyond-100% calcs), with the code-quality fixes of Oct 2026:
  - every series has a point for each job period inside its metric's own span (0 for additive metrics, NaN otherwise), so the time-series tests never skip a missing period;
  - a percent change is stated only from a positive base;
  - a derived value that isn't finite throws `NO_VALUE`, and a calc with no fact throws `CALC_UNDEFINED`; a level shift whose edge points are equal is not split by member.

## Public API

| Area | Exports |
|---|---|
| Statistics | `mean`, `median`, `mad`, `robustZ`, `theilSen`, `mannKendall` (tie-corrected, normal approximation), `normalCdf`, `twoProportionZ`, `hhi`, `sse` |
| Baselines and noise (§2) | `chooseBaseline` (last year → previous → trailing mean of 3; `{ sameLastYear: false }` starts at the previous period), `noiseBand` (2 × 1.4826 × MAD of the other changes, 6+ periods), `materiality` (band, ≥ 5%, ≥ 1% of mean), `MIN_PERIODS` |
| Insight templates (§3) | `periodChange`, `trend`, `trendBreak`, `anomalies`, `topContributors`, `newLost`, `mixShift`, `ratioShift`, `benchmarkGap`. Each returns an `Insight`: calcs with their inputs, roles, materiality, confidence and notes. Skipped tests become open questions. |
| Pareto and concentration (§11) | `concentration` (concentration.v1) and `dependence` (dependence.v1) read the exact member totals; `pareto.sql.ts` and `concentration.sql.ts` are the fixed SQL templates (class counts and values, top-1/3/5/10 shares, HHI) that `ConcentrationFacts` turns into `sql` facts with fixed labels (§14). `statValue` and `allStats` (`pareto.ts`) are the code path V2 recomputes them with; `trailingWindows` and `completeYears` (`windows.ts`) are the windows. `concentrationFacts` is what the planner's `concentration` tool runs; it refuses an unknown metric, a non-additive one, a dimension the metric does not have and periods that are not job periods (`ConcentrationError`). The pack covers every column of the pack metric's table with an entity or grouping role (`concentrationColumns`), split dimension or not: a role column the metric is not split by (`unsplitPackColumns`) gets its uncapped per-period members (`concentrationMembers`, `measure.ts`) for the section only, with no member series and so no findings. `concentrationSection` turns the pack's facts into the report's concentration entries (report-schema §5b), looked up by their fixed labels. |
| Scorecard (§12) | `planScorecard` / `planRow` plan a row per pack KPI, margin, then the other sums, counts and ratios (`scorecardMetrics`, at most `SCORECARD_ROWS` = 12) at the job's last period: the value, the change against `chooseBaseline` with `sameLastYear: false` (`vs_base`, `vs_base_pct` only over a positive base), the change against the same period a year earlier (`yoy`, `yoy_pct`, or n/a by `yoyGap`: `too_few_periods`, `grain_not_comparable`), the noise band (`noise_band` over the finite points, the last change left out) and the mean, and the `material` flag from `materiality()` (null without a band). `scorecardFacts` records them under `scorecard.<metric>.<cell>_<p>` (§14). No model call. |
| Analyses not run (§13) | `analysesNotRun({ notDrafted, metrics, sales?, concentration, grain, periods })`: margin and margin PVM without a cost role, PVM without a quantity or an item dimension (`pvmReadiness`), `contribution_margin` (no variable cost), Pareto and concentration without a money metric (`no_amount_role`), a dimension or the year before, year-on-year, and each `kpi.<id>` whose role is missing. Each entry has `analysis`, `reason_code`, a sentence with no numerals and the roles it `needs`. |
| Decomposers (§4) | `contribution` (contribution.v1; shares can exceed 100%, and then `beyond` holds the top member's `abs` magnitude, the largest offsetting member's and the `abs_exceeds` comparison as calcs; `contributionCalcs` lists every calc a contribution records and `beyondKeys` the decomposition fact keys for the beyond calcs), `pvm` (pvm.v1; exact identity plus new and lost, also when returns make the base quantity 0), `pvmMargin` and `marginEffect` (pvm_margin.v1, §10: volume, mix, price, unit cost, new, lost, unpriced; every effect is a calc with a fixed fact label, and `marginEffect` is the formula V2 recomputes with), `rateMix` (ratemix.v1 plus the Simpson guard), `diff` (diff.v1; support and risk ratio over 1–2 attribute combinations; not yet wired into the pipeline, spec §4.4) |
| Impact (§5) | `impactRange(scenario)`: `recover_share`, `price_change`, `remove_excess_rate`, `retain_at_risk`. Parameters are bounded, results are net of cost, and each is labelled "scenario estimate" with its formula. |
| Ranking (§6) | `rankInsights` (impact share × confidence × recency) and `topForExplain` (one finding per event, top 7) |
| Runner | `analyzeJob(ws, defs, catalog, { from, to, grain?, notDrafted? })` runs MEASURE (`measure.ts`) → DETECT → DECOMPOSE → RANK, then the report sections: `AnalysisResult.scorecard`, `.concentration` and `.notRun`. Every number becomes a fact: SQL with params plus cited `_row`s, or a function with input fact ids. Facts, insights and decompositions are written to the workspace. | PVM runs only where the profile's roles say so: a `quantity` column and an item dimension (`product`, `product_id` or `product_group`), read from `profile_roles` (semantics §1), not from header names.
| Agent tool entry points | `drillDown(ws, defs, catalog, { metric, period, dimension, range })` (contribution.v1 on one slice, the period vs the one before), `scenarioFacts(ws, defs, catalog, grain, request, justifiedBy)` (impact.v1 over existing facts, by fact id). New facts continue the job's numbering (`nextFactNumber`) and are stored with `persistFacts`. `readFacts` and `loadAnalysis` read a job's stored facts, insights and decompositions back (resume). `AnalysisError` codes: `UNKNOWN_SERIES`, `NO_VALUE`, `CALC_UNDEFINED`, `CIRCULAR_CALCS`, `BAD_SLICE`, `UNKNOWN_FACT`. |

## Example

```bash
bun run analyze evals/datasets/coffee-roaster-v1/files --today 2026-07-01 --currency USD
#   I5 trend_break.v1 revenue @ 2026-04 … change_pct −17.91% [N31]
#       contribution.v1 by channel: share:wholesale 107.59% [N141] …
#   I10 trend_break.v1 refund_rate @ 2026-04 … before 1.2 → latest 3.4
```
