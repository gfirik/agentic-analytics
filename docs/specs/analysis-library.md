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

**Seasonality** (M13a). A one-period spike or dip is **seasonal**, not a finding, when the same calendar period in another year (±1 or ±2 years, at month, quarter or week grain) moved the same way:

- The period stands out from both of its neighbours by ≥ 8%, and both neighbours are on the same side.
- The other year's period (matched by calendar label, not by position) moves in the same direction by between 0.5× and 2× as much. A +25% December against a +100% one is a seasonal shortfall, not the season.

The newest period has no next neighbour, so it is never judged seasonal: a drop there may be the start of a shift. A change measured against a seasonal period (January against a seasonal December peak) is seasonal only when it hasn't moved against the level outside the peak (November): a January that fell below November's level by ≥ 8% is a real change and stays a finding. A level shift is never seasonal: its next period stays shifted, so it isn't a spike. Withheld changes are listed in the open questions. The eval suite found this: every December peak was reported as a change.

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

Data-quality findings come from profiling, not from these templates. A change produced by a cell that profiling flagged as a unit error (×10, ×100, ×1000) is withheld from the findings. This applies to every metric that reads the flagged column, directly, through a ratio term or through a derived metric, whenever the insight compares or reports the flagged period. An open question says what was withheld and why, and the data-quality item stays in the report.

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

These three effects add up to the change in revenue exactly. Items that are new or discontinued are reported as separate "new" and "lost" effects. An item with revenue in both periods but zero quantity in one of them has no unit price to split; its whole change is a separate "unpriced" effect. Effects whose item group is empty are omitted rather than reported as 0. A test asserts the exact identity on 20 or more randomized cases.

This needs price and quantity columns. When they're missing, fall back to `contribution.v1`.

### 4.3 Rate vs mix (`ratemix.v1`) and the Simpson guard

For a ratio metric r = Σ wᵢ rᵢ, where the weights wᵢ are segment shares of the denominator:

- Mix effect = Σ (wᵢ₁ − wᵢ₀) rᵢ₀
- Rate effect = Σ wᵢ₁ (rᵢ₁ − rᵢ₀)

Both sums run over segments with a denominator in both periods. The weights are shares of each period's whole denominator, so segments present in only one period get their own effects, as new and lost items do in `pvm.v1`:

- Entering effect = Σ wᵢ₁ rᵢ₁ over segments with no denominator before
- Exiting effect = −Σ wᵢ₀ rᵢ₀ over segments with no denominator after

- Unattributed effect = the change in (numerators of segments with no denominator in that period ÷ the period's denominator), for example refunds booked for a customer with no sales that month. The measured rate counts every numerator, so this keeps the identity.

Mix + Rate + Entering + Exiting + Unattributed = r₁ − r₀ exactly. Effects are in the metric's own unit (percentage points for percent metrics).

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

Insights that detect one event (same series and period) are grouped. A group is represented by its highest-priority template among those carrying at least half of the group's best score, so a weak higher-priority template can't speak for a group made material by another. A template with no measured change (a trend: slope and p-value, no Δ) scores 0 but is not weak, and keeps its priority (found on Online Retail II, M13a). On equal scores the earlier period ranks first, because it is the onset of the change.

The order that goes to EXPLAIN:

First come the candidates:

- **Family firsts.** One candidate per metric family: its best whole-metric change. A channel slice such as `wholesale_revenue` is in the `revenue` family. The family's candidate is the parent metric's best change when that carries at least half the family's best score: the parent is the headline, and its decomposition names the driver. A rate's materiality is a small share of its own total, so without a per-family candidate a refund rate tripling would lose every slot to restatements of one revenue drop (M11).
- **The member story.** The most dramatic single-member change: the largest relative change (`change_pct`) among members whose impact share is ≥ 2%. Impact share is the same measure the score uses: |Δ| over the objective metric's total for the period (currency), or the percentage-point change / 100 (rates). A count-unit member has impact share 0 and is never a candidate. A member already named as the top driver of a family first is excluded. A member change on a slice speaks through the same member's change, in the same period, on the objective metric or the slice's parent, when that carries at least half its score: drafted slice ids often don't share the parent's id (`revenue_by_channel_walkin` next to `total_revenue`). Without this slot a product cannibalized by a launch never reaches the top (M13a).

Then the lead order (M14a). Small-model mode explains only 3 findings. With a real model drafting 8–15 metrics, the other families (gross margin, net profit, a second sales measure, a channel share) each restated the lead change and took slots 2 and 3, so the planted rate and member events were never explained. In the 2026-10-19 nightly run, P2 was found in 3 of 7 finished jobs and P3 in 0 of 7. The order:

1. **The lead.** This is the objective's own family first when it carries at least half the best family first's score, else the best family first. Gross margin often scores a little higher on the same event, but the report is about the objective.
2. **The rate story.** This is the percent-unit family first with the largest relative change.
3. **The member story.**
4. **The other family firsts.** Those with no measured change (score 0: counts, trends) come after every material one.
5. Everything else, by score.

In 2, 3 and 4, a change in another period than the lead's comes before one in the lead's period. A change in the lead's period, in any metric and either direction, is usually the lead event seen through another measure, while a change in another period is another event.

## 7. Tests

- Every template and decomposer has fixtures with hand-computed expected values, written by hand in the test file with the arithmetic shown in comments.
- Property tests check that the PVM and contribution identities hold and that the Simpson guard fires on a classic Simpson dataset.
- The coffee-roaster example from `docs/assets/blueprint.html` is a golden test. Expected outputs:
  - revenue Apr vs Mar −17.9%;
  - wholesale contribution 108%;
  - refund rate 1.2% → 3.4%.
