---
title: Detecting changes
description: The insight templates, the noise band, and how findings are ranked.
sidebar:
  order: 5
---

Every confirmed metric is measured per period and per dimension member in SQL. **Insight templates** then look for changes worth a reader's time:

| Template | Detects | Method |
|---|---|---|
| `period_change.v1` | Latest period vs its baseline | Δ, Δ%, materiality test |
| `trend.v1` | Sustained direction | Theil–Sen slope + Mann–Kendall (p < 0.05) |
| `trend_break.v1` | A level shift | Best single split, ≥ 3 points a side, beyond the noise band |
| `anomaly.v1` | An unusual period | Robust z of the residual > 3.5 |
| `top_contributors.v1` | Which members drove a change | Additive contribution |
| `concentration.v1` | Dependence on few customers or products | Top-1 share ≥ 30% or HHI ≥ 0.25 |
| `new_lost.v1` | Members that appeared or disappeared | Presence by period; value at risk |
| `mix_shift.v1` | Share changes between members | Δ share ≥ 3 pp |
| `ratio_shift.v1` | A change in a rate | Two-proportion z-test, else the noise band |
| `benchmark_gap.v1` | Own figure vs an outside range | Web extracts only, always labelled External |

A change is **material** only if it is larger than the series' own noise (a robust band from the median absolute deviation) and than a minimum share of the total. Every statistic is a fact with its inputs; the verifier recomputes each one.

**Ranking.** Findings are scored by |impact as a share of the metric's total| × confidence × recency. Several templates often detect one event, so they are grouped by series and period. Each metric family (a channel slice such as `wholesale_revenue` belongs to `revenue`) gets one slot before any family gets a second — otherwise a refund rate tripling would lose every slot to restatements of one revenue drop. A family's slot goes to the parent metric when it scores at least half of the family's best, since the parent's breakdown names the driver. Then one slot goes to the most dramatic single-member change (the largest relative change among members with an impact share of at least 2%), unless that member is already the named driver of a change above it: a product cannibalized by a launch otherwise never reaches the top. On equal scores the earlier period, the onset, goes first. The top 3–7 go to EXPLAIN.

**Seasonality.** A one-period spike or dip that recurs in the same calendar period of another year, by between half and twice as much, is seasonal and is listed as an open question instead of a finding. So is a change measured against such a peak that hasn't moved against the level outside it. The newest period is never judged seasonal, and a level shift never is: its next period stays shifted.
