# @agentic-analytics/analysis

The engine's deterministic numbers core. It measures metrics, detects changes, decomposes them into drivers, computes impact ranges and ranks findings. Everything is SQL (through the metric compiler) or a pure TypeScript function with a hand-computed test. The model never replaces any of it (DECISIONS D9).

- **Spec:** docs/specs/analysis-library.md
- **Status:** M5.

## Public API

| Area | Exports |
|---|---|
| Statistics | `mean`, `median`, `mad`, `robustZ`, `theilSen`, `mannKendall` (tie-corrected, normal approximation), `normalCdf`, `twoProportionZ`, `hhi`, `sse` |
| Baselines and noise (§2) | `chooseBaseline` (last year → previous → trailing mean of 3), `noiseBand` (2 × 1.4826 × MAD of the other changes, 6+ periods), `materiality` (band, ≥ 5%, ≥ 1% of mean), `MIN_PERIODS` |
| Insight templates (§3) | `periodChange`, `trend`, `trendBreak`, `anomalies`, `topContributors`, `concentration`, `newLost`, `mixShift`, `ratioShift`, `benchmarkGap`. Each returns an `Insight`: calcs with their inputs, roles, materiality, confidence and notes. Skipped tests become open questions. |
| Decomposers (§4) | `contribution` (contribution.v1; shares can exceed 100%), `pvm` (pvm.v1; exact identity plus new and lost), `rateMix` (ratemix.v1 plus the Simpson guard), `diff` (diff.v1; support and risk ratio over 1–2 attribute combinations) |
| Impact (§5) | `impactRange(scenario)`: `recover_share`, `price_change`, `remove_excess_rate`, `retain_at_risk`. Parameters are bounded, results are net of cost, and each is labelled "scenario estimate" with its formula. |
| Ranking (§6) | `rankInsights` (impact share × confidence × recency) and `topForExplain` (one finding per event, top 7) |
| Runner | `analyzeJob(ws, defs, catalog, { from, to, grain? })` runs MEASURE → DETECT → DECOMPOSE → RANK. Every number becomes a fact: SQL with params plus cited `_row`s, or a function with input fact ids. Facts, insights and decompositions are written to the workspace. |
| Agent tool entry points | `drillDown(ws, defs, catalog, { metric, period, dimension, range })` (contribution.v1 on one slice, the period vs the one before), `scenarioFacts(ws, defs, catalog, grain, request, justifiedBy)` (impact.v1 over existing facts, by fact id). New facts continue the job's numbering (`nextFactNumber`) and are stored with `persistFacts`. `readFacts` and `loadAnalysis` read a job's stored facts, insights and decompositions back (resume). `AnalysisError` codes: `UNKNOWN_SERIES`, `NO_VALUE`, `CALC_UNDEFINED`, `CIRCULAR_CALCS`, `BAD_SLICE`, `UNKNOWN_FACT`. |

## Example

```bash
bun run analyze evals/datasets/coffee-roaster-v1/files --today 2026-07-01 --currency USD
#   I5 trend_break.v1 revenue @ 2026-04 … change_pct −17.91% [N31]
#       contribution.v1 by channel: share:wholesale 107.59% [N141] …
#   I10 trend_break.v1 refund_rate @ 2026-04 … before 1.2 → latest 3.4
```
