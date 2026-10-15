# Spec: analysis library (`packages/analysis`)

This package is the engine's brain for numbers. Everything in it is deterministic, written in SQL or TypeScript, and unit-tested with hand-computed answers. The model never replaces it. The model only chooses among its outputs and explains them.

Every output is stored as `facts`, `insights` or `decompositions` rows. Each row carries:

- a method id (for example `pvm.v1`);
- the inputs;
- the provenance.

## 1. Measure

For each confirmed metric, compute the value:

- per period, at the job grain;
- per period for each listed dimension member, capped at the top 50 members by absolute value plus an "other" bucket.

## 2. Baselines, noise and materiality

**Baselines.** Use the first one that applies:

1. Same period last year. Needs 13 or more months of data.
2. The previous period.
3. The trailing mean of the last 3 periods.

The method used is recorded.

**Noise band.**

- Compute the median absolute deviation (MAD) of the historical period-over-period changes for that series.
- A change is **material** only when all of these hold:
  - |Δ| > 2 × 1.4826 × MAD;
  - |Δ%| ≥ 5%, configurable;
  - |Δ| ≥ the minimum absolute amount, by default 1% of the series mean.
- With fewer than 6 periods there is no MAD band, so only the % and absolute thresholds apply, and the finding's confidence is capped at medium.

**Minimum data.** These tests are skipped when there isn't enough data. Each skip is logged as an open question.

| Test | Needs |
|---|---|
| Trend | 4+ periods |
| Anomaly | 6+ periods |
| Year-over-year | 13+ months |
| Trend break | 3+ periods on each side |

## 3. Insight templates (`InsightTemplate`)

| id | Detects | Method |
|---|---|---|
| `period_change.v1` | Latest period vs baseline per metric and per dimension member | Δ, Δ%, materiality test |
| `trend.v1` | Sustained direction | Theil–Sen slope + Mann–Kendall test (p < 0.05) |
| `trend_break.v1` | Level shift | Best single split minimizing within-segment SSE; ≥ 3 points per side; mean difference > noise band |
| `anomaly.v1` | Unusual period | Robust z of the residual vs baseline > 3.5 |
| `top_contributors.v1` | Which members drove a material change | Additive contribution (§4.1) |
| `concentration.v1` | Dependence on few customers or products | Top-1 share ≥ 30% or HHI ≥ 0.25 |
| `new_lost.v1` | Members that appeared or disappeared | Present in baseline and absent now (and the reverse); value at risk |
| `mix_shift.v1` | Share changes between members | Δ share in percentage points, material if ≥ 3 pp |
| `ratio_shift.v1` | Change in a rate metric | Two-proportion z-test when counts are known (p < 0.05); else noise band |
| `benchmark_gap.v1` | Own figure vs external range | Only with web extracts; always labelled external |

Data-quality findings come from profiling, not from these templates.

## 4. Decomposition (`Decomposer`)

### 4.1 Additive contribution (`contribution.v1`)

For T = Σ xᵢ:

- ΔT = Σ Δxᵢ, and shareᵢ = Δxᵢ / ΔT.
- Positive and negative contributors are reported separately.
- Shares can exceed 100% when contributors offset each other. Example: wholesale −8,500 and retail +600 make a total of −7,900, so wholesale's share is 108%.

### 4.2 Price–volume–mix (`pvm.v1`)

For revenue R = Σ pᵢqᵢ over items present in both periods, with Q = Σ qᵢ, mix shares sᵢ = qᵢ/Q and base average price P̄₀ = Σ sᵢ₀ pᵢ₀:

- Volume = (Q₁ − Q₀) · P̄₀
- Mix = Q₁ · (Σ sᵢ₁ pᵢ₀ − Σ sᵢ₀ pᵢ₀)
- Price = Σ qᵢ₁ (pᵢ₁ − pᵢ₀)

These three effects add up to the change in revenue exactly. Items that are new or discontinued are reported as separate "new" and "lost" effects. A test asserts the exact identity on 20 or more randomized cases.

This needs price and quantity columns. When they're missing, fall back to `contribution.v1`.

### 4.3 Rate vs mix (`ratemix.v1`) and the Simpson guard

For a ratio metric r = Σ wᵢ rᵢ, where the weights wᵢ are segment shares of the denominator:

- Mix effect = Σ (wᵢ₁ − wᵢ₀) rᵢ₀
- Rate effect = Σ wᵢ₁ (rᵢ₁ − rᵢ₀)

**Simpson guard:** when the overall rate moves in the opposite direction to most segment rates, emit a `simpson_risk` flag. The finding must then present the segment-level story.

### 4.4 Risk-ratio explanation (`diff.v1`, after MacroBase DIFF)

Used for anomalies in counts or rates. Compare the anomalous period A against the baseline B over attribute combinations of 1–2 dimensions:

- support = share of A's events with the combination;
- risk ratio = (a / (a + b)) / (c / (c + d)).

Report combinations with support ≥ 5% and risk ratio ≥ 2, with at most 5 combinations ranked by support × log(RR).

### 4.5 Shapley attribution (`shapley.v1`)

For non-additive formulas such as ratios of sums or products of 6 factors or fewer, use exact Shapley values over the factor changes. This is P1 and may ship after v0.1.

## 5. Impact ranges (`impact.v1`)

The engine never gives point forecasts. A recommendation's impact is a scenario computed in code:

- The agent picks a scenario type and parameters from an allowed set:
  - recover share of a lost amount: 0.3–0.9;
  - apply a price change: −15% to +15%;
  - remove an excess rate back to the baseline;
  - retain at-risk value: 0.3–0.9.
- The agent must cite the findings that justify each parameter.
- Code computes low and high, net of the cost the action implies (for example a discount).
- The result is labelled "scenario estimate", and the formula and inputs are stored in the report.
- Calibration against outcomes is P2. Until then the report never claims a probability.

## 6. Ranking findings

Each material insight is scored as:

**materiality** = |impact on the objective metric, as a share of that metric's period total| × confidence weight (high = 1, medium = 0.6, low = 0.3) × recency weight (latest period = 1, decaying by 0.8 per period back).

The top 3–7 findings go to EXPLAIN. The rest stay in the appendix.

## 7. Tests

- Every template and decomposer has fixtures with hand-computed expected values, written by hand in the test file with the arithmetic shown in comments.
- Property tests check that the PVM and contribution identities hold and that the Simpson guard fires on a classic Simpson dataset.
- The coffee-roaster example from `docs/assets/blueprint.html` is a golden test. Expected outputs:
  - revenue Apr vs Mar −17.9%;
  - wholesale contribution 108%;
  - refund rate 1.2% → 3.4%.
