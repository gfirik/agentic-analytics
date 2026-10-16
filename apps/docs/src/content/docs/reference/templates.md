---
title: Insight templates and decomposers
description: The detection and decomposition methods, by id.
---

| Template | Detects |
|---|---|
| `period_change.v1` | Latest period vs baseline |
| `trend.v1` | Sustained direction (Theil–Sen + Mann–Kendall) |
| `trend_break.v1` | A level shift |
| `anomaly.v1` | An unusual period (robust z > 3.5) |
| `top_contributors.v1` | Members that drove a change |
| `concentration.v1` | Dependence on few members (top share ≥ 30% or HHI ≥ 0.25) |
| `new_lost.v1` | Members that appeared or disappeared |
| `mix_shift.v1` | Share changes ≥ 3 pp |
| `ratio_shift.v1` | A change in a rate |
| `benchmark_gap.v1` | Own figure vs an external range |

| Decomposer | Splits |
|---|---|
| `contribution.v1` | A total into member contributions |
| `pvm.v1` | Revenue into price, volume, mix, new, lost, unpriced |
| `ratemix.v1` | A rate into mix, rate, entering, exiting, unattributed (with the Simpson guard) |
| `diff.v1` | An anomaly into attribute combinations by risk ratio |

Formulas and tests: `docs/specs/analysis-library.md`. Each method is explained with examples in [Finding drivers](../../how-it-works/drivers/).
