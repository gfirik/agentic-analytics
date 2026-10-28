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

Every series has a point for each job period (a period where any metric has data) inside its metric's own first..last period, because the tests below work by position: a missing period is 0 for an additive metric (sum, count, distinct count) and unknown (NaN, skipped) for an average or ratio. Nothing is added outside that span, so a table that starts later gets no zeros before its first row, and a period with no data at all stays a gap (profile's `missing_periods`).

## 2. Baselines, noise and materiality

**Percent change.** Δ% = (value ÷ base − 1) × 100 is stated (as a `change_pct` fact) only when the base is positive. From 0 it is undefined, and from a negative base it flips the sign (a loss going −10 → −5 would read −50%), so the change is stated alone. The materiality test still uses the relative size against |base|.

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
- When the top member moved by more than the whole change (|Δx₁| > |ΔT|), a share over 100% reads like an error, so the decomposition also records what a sentence needs to say it in magnitudes (M14a):
  - `magnitude:<member>` = |Δx₁| and `magnitude:<offset>` = |Δx| of the largest member that moved against the total (function `abs`, input: the signed change);
  - `exceeds:<member>` = 1 (function `abs_exceeds`, inputs: Δx₁ and ΔT; 1 when |Δx₁| > |ΔT|), so "more than the whole drop" is a recomputed fact like any number.

  Hand-computed (coffee-roaster April): |−8,500| = 8,500; |+600| = 600; |−8,500| > |−7,900|, so 1. The claim reads "By channel, “wholesale” fell {{8,500}}, more than the whole drop; “retail” rose {{600}}." The drop itself is the sentence before it.

### 4.2 Price–volume–mix (`pvm.v1`)

For revenue R = Σ pᵢqᵢ over items present in both periods, with Q = Σ qᵢ, mix shares sᵢ = qᵢ/Q and base average price P̄₀ = Σ sᵢ₀ pᵢ₀:

- Volume = (Q₁ − Q₀) · P̄₀
- Mix = Q₁ · (Σ sᵢ₁ pᵢ₀ − P̄₀) = Σ qᵢ₁ pᵢ₀ − Q₁ P̄₀
- Price = Σ qᵢ₁ (pᵢ₁ − pᵢ₀)

These three effects add up to the change in revenue exactly. **Zero base quantity:** when the common items' Q₀ = 0 (returns netting out) while their revenue is not 0, P̄₀ is undefined, so Volume = 0 and Mix = Σ qᵢ₁ pᵢ₀ − Σ qᵢ₀ pᵢ₀, as in §10. Hand-computed: A r 20 → 12, q 5 → 3 (p 4 → 4); B r −10 → 4, q −5 → 2 (p 2 → 2). ΔR = (12 + 4) − (20 − 10) = 6. Volume = 0; Mix = (3·4 + 2·2) − (20 − 10) = 6; Price = 0; the effects add up to 6. (As built, M15 PR 8: before it P̄₀ was set to 0 and the effects added up to 16.) `pvm.v1` is the case of `pvm_margin.v1` with no unit cost, and both call one function for the common items' effects (`pvm-kernel.ts`). Items that are new or discontinued are reported as separate "new" and "lost" effects. An item with revenue in both periods but zero quantity in one of them has no unit price to split; its whole change is a separate "unpriced" effect. Effects whose item group is empty are omitted rather than reported as 0. A test asserts the exact identity on 20 or more randomized cases.

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

**Not wired yet.** `diff` is implemented and tested, but no stage calls it, and it returns bare numbers (support, risk ratio) without `Calc` records. It needs those records, inputs and facts before a finding may use it (rule 1).

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

- **Family firsts.** One candidate per metric family: its best whole-metric change. A channel slice such as `wholesale_revenue` is in the `revenue` family. From M15 (PR 7), families are grouped by definition first (`sliceParents`, metrics): a metric with the same type, table, expression, time column and cohort as another, and more filters that include all of the other's, is its slice. The id-suffix rule remains for ids that definition does not place. A member is "told" only by a family first with a score above 0, so a count's driver does not swallow the member story. The family's candidate is the parent metric's best change when that carries at least half the family's best score: the parent is the headline, and its decomposition names the driver. A rate's materiality is a small share of its own total, so without a per-family candidate a refund rate tripling would lose every slot to restatements of one revenue drop (M11).
- **The member story.** The most dramatic single-member change: the largest relative change (`change_pct`) among members whose impact share is ≥ 2%. Impact share is the same measure the score uses: |Δ| over the objective metric's total for the period (currency), or the percentage-point change / 100 (rates). A count-unit member has impact share 0 and is never a candidate. A member already named as the top driver of a family first is excluded. A member change on a slice speaks through the same member's change, in the same period, on the objective metric or the slice's parent, when that carries at least half its score: drafted slice ids often don't share the parent's id (`revenue_by_channel_walkin` next to `total_revenue`). Without this slot a product cannibalized by a launch never reaches the top (M13a).

Then the lead order (M14a). Small-model mode explains only 3 findings. With a real model drafting 8–15 metrics, the other families (gross margin, net profit, a second sales measure, a channel share) each restated the lead change and took slots 2 and 3, so the planted rate and member events were never explained. In the 2026-10-19 nightly run, P2 was found in 3 of 7 finished jobs and P3 in 0 of 7. The order:

1. **The lead.** This is the objective's own family first when it carries at least half the best family first's score, else the best family first. Gross margin often scores a little higher on the same event, but the report is about the objective.
2. **The rate story.** This is the percent-unit family first with the largest relative change.
3. **The member story.**
4. **The other family firsts.** Those with no measured change (score 0: counts, trends, the pack's average order value) come after every material change, including the non-first changes of step 5 (M15 PR 7: with the KPI pack's counts ahead of them they took the slots 4–7 and pushed a planted member story out of the top 5).
5. Everything else, by score.

In 2, 3 and 4, a change in another period than the lead's comes before one in the lead's period. A change in the lead's period, in any metric and either direction, is usually the lead event seen through another measure, while a change in another period is another event.

## 7. Tests

- Every template and decomposer has fixtures with hand-computed expected values, written by hand in the test file with the arithmetic shown in comments.
- Property tests check that the PVM and contribution identities hold and that the Simpson guard fires on a classic Simpson dataset.
- The coffee-roaster example from `docs/assets/blueprint.html` is a golden test. Expected outputs:
  - revenue Apr vs Mar −17.9%;
  - wholesale contribution 108%;
  - refund rate 1.2% → 3.4%.

## 8. Analysis packs (M15)

A **pack** is a fixed list of metrics and templates that a set of roles or table kinds unlocks (semantics §1–§3; analyst-grade §3.2). The runner runs every pack whose requirements are met, and lists each one that isn't under "Analyses not run" (§13). Ranking (§6) is still the only place that decides what reaches EXPLAIN. The scorecard (§12) and the concentration section (§11) are their own report sections, so a bigger metric set doesn't push other findings out.

Rules for every pack:

- **Every number is a fact.** A pack's numbers come from a parameterized SQL template (`.sql.ts`) or a pure function in this package, with a `computation` record. Each function has a V2 rule (agent-and-verifier §7), and its hand-computed test also runs through V2.
- **Roles, not names.** Packs read confirmed or assumed roles (semantics §5), never column-name regexes. PR 5 moves the runner's `QTY`/`ITEM` regexes and `fallbackMetrics`' name guesses onto roles.
- **Fixed labels.** Each pack's facts carry the labels in §14, so golden items can name them before the engine exists.

The M15 packs, in their default order (semantics §4 reorders them per business model):

| Pack | Section | Unlocked by |
|---|---|---|
| Sales KPIs | §8.1 | a `sales_lines` table (or `invoices` when there is none) |
| Margin | §9 | the sales KPIs + `unit_cost` (with `quantity`) or `cost_amount` |
| Margin PVM | §10 | margin + `quantity` + a product entity |
| Pareto and concentration | §11 | an additive currency metric + a dimension with an entity or `channel`, `location`, `salesperson`, `product_group` role |
| Scorecard | §12 | any pack KPI or confirmed metric |

### 8.1 Sales KPI pack (drafted by code)

From a sales-lines table's roles, code drafts these metric definitions (metric-layer §2). Each one is drafted only when its roles exist. Each missing one becomes an "Analyses not run" entry (§13).

**Revenue lines** are the table's rows minus those whose `status` is in the refund or cancellation class: refunded, returned, cancelled, canceled, a true `is_canceled`-style flag; RU возврат, отменён; UZ qaytarilgan, bekor qilingan. The value lists live in code next to the synonyms (semantics §2.3). Negative-quantity lines are not removed: they net out, as today.

| id | Type | Definition | Needs |
|---|---|---|---|
| `revenue` | sum | Σ `amount` over revenue lines; with no `amount`, Σ `quantity` × `unit_price` (minus `discount` when the net identity holds, semantics §2.2) | `amount`, or `quantity` + `unit_price` |
| `orders` | count_distinct | distinct `order_id` (else `invoice_id`) over revenue lines | `order_id` or `invoice_id` |
| `units` | sum | Σ `quantity` over revenue lines | `quantity` |
| `aov` | ratio | `revenue` ÷ `orders`, unit currency | revenue + orders |
| `customers` | count_distinct | distinct customer entity (the id when both exist) over revenue lines | a customer entity |
| `new_customers` | count_distinct | customers active in the period whose first revenue line in the table falls in that period | a customer entity |
| `returning_customers` | count_distinct | customers active in the period whose first revenue line is earlier | a customer entity |
| `refund_rate` | ratio, percent | with `refund_amount`: Σ `refund_amount` ÷ `revenue` × 100. Else, with a `status` in the refund class: Σ the revenue expression over the lines in that class ÷ `revenue` × 100 (the value of what was refunded as a share of revenue, which is net of the refunded lines: a share of net sales, not of gross; a refund is money, and this keeps the M5 answer key and the benchmark comparison of the coffee demo) | `refund_amount`, or `status` with refund values |
| `cancellation_rate` | ratio, percent | orders (or rows) with a cancellation status ÷ all orders (or rows) × 100. "Orders" is distinct `order_id`, drafted as the helper metrics `cancelled_orders` and `all_orders` (a ratio term can only sum); with no order id a row stands for one order and the terms sum 1 per row | `status` with cancellation values |
| `discount_rate` | ratio, percent | Σ `discount` ÷ gross sales × 100, where gross sales = Σ `quantity` × `unit_price` over revenue lines, or Σ (`amount` + `discount`) when there is no price, with the assumption "amount is net of discount" | `discount` |

- **New and returning customers** have no history before the table's first period, so they are not stated for that period. Every customer there would read as new. The not-run entry says so.
- **As built (M15 PR 7).** `salesKpiPack` (packages/metrics) drafts the table above from the roles, on the largest dated `sales_lines` table (else `invoices`; a table of another kind with the same roles is used last, as the name-based fallback was before roles). Details the table does not show:
  - `aov` has unit `currency` in the revenue's currency (a ratio may be `percent`, `ratio` or `currency`: money per unit is a currency ratio); when the profile knows no currency it falls back to `ratio`.
  - `new_customers` and `returning_customers` are `count_distinct` metrics with `cohort: new | returning` (metric-layer §1). The compiler joins each customer's first revenue line in the table, whatever the query's period range, and leaves the table's first period out.
  - A status column is read by its values (refund or cancellation words in English, Russian, Uzbek) or, for a 0/1 or boolean column, by its header (`is_canceled`). Several status columns each add a revenue-line filter.
  - With no `amount`, revenue is Σ `quantity` × `unit_price`, gross: the net-of-discount identity needs an amount column, so no discount is subtracted.
  - `notDrafted` lists each KPI the roles could not support with the §13 reason (`no_order_id`, `no_quantity_role`, `no_customer_role`, `no_refund_role`, `no_status_role`, `no_discount_role`), only for a `sales_lines` or `invoices` table; PR 10 renders it as "Analyses not run".
- **Slicing.** Every KPI is measured per period and per dimension member as in §1. A ratio is sliced by slicing its numerator and denominator (analyst-grade §2.2).
- **Dedupe by definition.** The model's drafts are added after the code's, and two definitions are the same metric when their type, table, expression (whitespace and case normalized) and filter set are equal. For a ratio, its numerator and denominator must be the same too. The surviving id is the user's (a confirmed metric), else the code's, else the model's. As built: `mergeMetricSets` merges the code's pack, then the model's validated draft (or the fallback's channel slices); a later duplicate is merged into the earlier one (its dimensions are added), references to its id are renamed, and a later metric that reuses an earlier id with a different definition is rejected with that reason (a model's `revenue` that differs from the pack's is replaced by the pack's, and metrics that refer to `revenue` now mean the pack's). The list of merged ids is kept in `metrics.drafted.json` (`merged`). This also closes the [M14a] gap "families grouped by id suffix": families are grouped by definition (§6).

### 8.2 Hand-computed KPI fixture (one month, 10 lines)

These are the same rows as PR 7's test and semantics §2.2's gross-vs-net example. `amount` is net of `discount`.

| line | order | customer | product | qty | unit price | discount | amount | status |
|---|---|---|---|---|---|---|---|---|
| 1 | O1 | C1 | A | 2 | 100.00 | 0 | 200.00 | paid |
| 2 | O1 | C1 | B | 1 | 150.00 | 0 | 150.00 | paid |
| 3 | O2 | C2 | A | 3 | 100.00 | 0 | 300.00 | paid |
| 4 | O3 | C1 | B | 2 | 150.00 | 0 | 300.00 | paid |
| 5 | O4 | C3 | A | 1 | 100.00 | 0 | 100.00 | refunded |
| 6 | O5 | C4 | C | 4 | 50.00 | 20.00 | 180.00 | paid |
| 7 | O6 | C2 | D | 5 | 85.00 | 0 | 425.00 | paid |
| 8 | O7 | C5 | B | 1 | 150.00 | 0 | 150.00 | refunded |
| 9 | O8 | C3 | B | 2 | 150.00 | 30.00 | 270.00 | paid |
| 10 | O8 | C3 | C | 1 | 50.00 | 0 | 50.00 | paid |

The revenue lines are 1–4, 6, 7, 9 and 10 (lines 5 and 8 are refunded).

- `revenue` = 200 + 150 + 300 + 300 + 180 + 425 + 270 + 50 = **1,875.00**
- `orders` = {O1, O2, O3, O5, O6, O8} = **6**
- `aov` = 1,875.00 ÷ 6 = **312.50**
- `units` = 2 + 1 + 3 + 2 + 4 + 5 + 2 + 1 = **20**
- `customers` = {C1, C2, C3, C4} = **4** (C3 is counted through O8; C5 has only a refunded order)
- `refund_rate` (status form; refunded lines 5 and 8 are worth 100.00 + 150.00 = 250.00) = 250 ÷ 1,875 × 100 = **13.3333…%**
- `cancellation_rate`, with line 8's status read as `cancelled` instead (all orders O1–O8 = 8, cancelled O7 = 1) = 1 ÷ 8 × 100 = **12.5%**
- `discount_rate`: discounts 20.00 + 30.00 = 50.00; gross sales = Σ qty × price over revenue lines = 200 + 150 + 300 + 300 + 200 + 425 + 300 + 50 = 1,925.00; 50.00 ÷ 1,925.00 × 100 = **2.597402…%**
- *New vs returning*, with one earlier month in which C1 and C6 bought: in this month C1 is **returning** (1), and C2, C3 and C4 are **new** (3).

## 9. Margin

Margin is drafted by code when a cost role exists.

- **`cost`**: Σ `quantity` × `unit_cost` over revenue lines, or Σ `cost_amount` when that role exists. Rows with a null cost are left out of margin on both sides. When any revenue line in a period has no cost, the pack drafts `costed_revenue` (revenue over the lines with a cost) and uses it in place of `revenue` below. It also records the assumption "margin covers only lines with a cost" and cites the missing-value quality item.
- **`gross_margin`** = revenue − cost. It is a derived metric (`expression: revenue - cost`). Its value for a period or member is a function fact: `fn: gross_margin`, inputs [revenue fact, cost fact] of the same period and member, value a − b. V2 recomputes it from those inputs, and V4 checks that the inputs are measured from the definition's two terms (agent-and-verifier §7).
- **`gross_margin_pct`** = gross_margin ÷ revenue × 100. It is a ratio metric (numerator `gross_margin`, denominator `revenue`), so it is sliced by slicing its numerator and denominator. Its value is a function fact: `fn: gross_margin_pct`, inputs [revenue, cost], value (a − b) ÷ a × 100. It is not stated when revenue ≤ 0, as with Δ% (§2).
- **Margin by member:** the same facts per product, customer and channel member (the top 50 by revenue plus "(other)", as in §1).
- **Contribution margin** needs variable-cost data that no M15 dataset has. It is listed under "Analyses not run" (`contribution_margin`, `no_variable_cost`).
- **Without a cost role,** margin, margin by member and margin PVM are not run (`no_cost_role`). A claim that names margin anyway is dropped by V4's role check (agent-and-verifier §7).

**Hand-computed** (the same two products as §10's first case):

| Product | Period 0: revenue, cost, margin, margin % | Period 1: revenue, cost, margin, margin % |
|---|---|---|
| A | 10 × 5 = 50; 10 × 3 = 30; 20; 20 ÷ 50 = 40% | 12 × 5 = 60; 12 × 4 = 48; 12; 12 ÷ 60 = 20% |
| B | 10 × 10 = 100; 10 × 6 = 60; 40; 40 ÷ 100 = 40% | 8 × 11 = 88; 8 × 6 = 48; 40; 40 ÷ 88 = 45.4545…% |
| Total | 150; 90; **60**; 60 ÷ 150 = **40%** | 148; 96; **52**; 52 ÷ 148 = **35.135135…%** |

Revenue is nearly flat (150 → 148) while margin falls 60 → 52: a margin squeeze. The product with the lowest margin % in period 1 is A (20%).

## 10. Margin price–volume–mix (`pvm_margin.v1`)

This extends `pvm.v1` (§4.2) to margin, with one more effect for unit cost. For each item i, it uses unit price pᵢ = rᵢ ÷ qᵢ, unit cost cᵢ = costᵢ ÷ qᵢ and unit margin uᵢ = pᵢ − cᵢ. Over the items present in both periods with non-zero quantity, it uses Q = Σ qᵢ, sᵢ = qᵢ ÷ Q and the base average unit margin ū₀ = Σ sᵢ₀ uᵢ₀.

- Volume = (Q₁ − Q₀) · ū₀
- Mix = Q₁ · (Σ sᵢ₁ uᵢ₀ − ū₀), computed as Σ qᵢ₁ uᵢ₀ − Q₁ ū₀ (the same value, and defined when Q₁ = 0)
- Price = Σ qᵢ₁ (pᵢ₁ − pᵢ₀)
- Cost = −Σ qᵢ₁ (cᵢ₁ − cᵢ₀)

**Identity.** Volume + Mix = Σ qᵢ₁uᵢ₀ − Q₀ū₀ = Σ qᵢ₁uᵢ₀ − Σ qᵢ₀uᵢ₀. Price + Cost = Σ qᵢ₁((pᵢ₁ − cᵢ₁) − (pᵢ₀ − cᵢ₀)) = Σ qᵢ₁uᵢ₁ − Σ qᵢ₁uᵢ₀. So Volume + Mix + Price + Cost = Σ qᵢ₁uᵢ₁ − Σ qᵢ₀uᵢ₀, the common items' change in margin, exactly.

The rest of the change goes to separate effects, as in `pvm.v1`. An item is present in a period when its revenue or its cost there is non-zero.

- **New**: +Σ (r₁ − cost₁) over items present only in period 1.
- **Lost**: −Σ (r₀ − cost₀) over items present only in period 0.
- **Unpriced**: the whole margin change of items present in both periods but with zero quantity in one of them (no unit price or unit cost to split). Uncosted lines are already outside margin (§9).
- Effects whose item group is empty are omitted. The sum of all effects is ΔM = M₁ − M₀.

**Zero base quantity.** Returns can make the common items' Q₀ = 0 while their margin is not 0. Then ū₀ is undefined, so Volume = 0 and Mix = Σ qᵢ₁uᵢ₀ − Σ qᵢ₀uᵢ₀, which keeps the identity. Hand-computed: A q 5 → 3, p 4, c 1 (u = 3); B q −5 → 2, p 4 → 5, c 3 (u 1 → 2). Q₀ = 0, M₀ = 15 − 5 = 10, M₁ = 9 + 4 = 13, ΔM = 3. Volume = 0; Mix = (3·3 + 2·1) − (5·3 + (−5)·1) = 11 − 10 = 1; Price = 3·0 + 2·1 = 2; Cost = 0. 0 + 1 + 2 + 0 = 3. (`pvm.v1` follows the same rule since PR 8; before it set P̄₀ to 0 and broke its identity when R₀ ≠ 0, §4.2.)

**Hand-computed case 1** (A2/A3's fixed case; PR 8's test):

- A: q 10 → 12, p 5 → 5, c 3 → 4, so u 2 → 1. B: q 10 → 8, p 10 → 11, c 6 → 6, so u 4 → 5.
- M₀ = 10·2 + 10·4 = 60. M₁ = 12·1 + 8·5 = 52. ΔM = **−8**.
- Q₀ = Q₁ = 20. s₀ = (0.5, 0.5), ū₀ = 0.5·2 + 0.5·4 = 3. s₁ = (0.6, 0.4).
- Volume = (20 − 20)·3 = **0**.
- Mix = 20·(0.6·2 + 0.4·4 − 3) = 20·(1.2 + 1.6 − 3) = 20·(−0.2) = **−4**. Check: Σ q₁u₀ − Q₁ū₀ = (12·2 + 8·4) − 20·3 = 56 − 60 = −4.
- Price = 12·(5 − 5) + 8·(11 − 10) = **8**.
- Cost = −(12·(4 − 3) + 8·(6 − 6)) = **−12**.
- Sum: 0 − 4 + 8 − 12 = **−8** = ΔM.

**Hand-computed case 2** (volume, new, lost and unpriced items):

- A: q 10 → 16, p 5 → 5, c 3 → 3.5 (u 2 → 1.5). B: q 10 → 5, p 10, c 6 (u 4). C new: q₁ 4, p 8, c 5 (margin 32 − 20 = 12). D lost: q₀ 2, p 20, c 12 (margin 40 − 24 = 16). E: r 30 → 10, cost 18 → 0, q 3 → 0 (unpriced; margin 12 → 10).
- M₀ = 20 + 40 + 16 + 12 = 88. M₁ = 24 + 20 + 12 + 10 = 66. ΔM = **−22**.
- Common items A and B: Q₀ = 20, Q₁ = 21, ū₀ = (10·2 + 10·4) ÷ 20 = 3.
- Volume = (21 − 20)·3 = **3**. Mix = (16·2 + 5·4) − 21·3 = 52 − 63 = **−11**. Price = 16·0 + 5·0 = **0**. Cost = −(16·0.5 + 5·0) = **−8**.
- New = **+12**. Lost = **−16**. Unpriced = 10 − 12 = **−2**.
- Sum: 3 − 11 + 0 − 8 + 12 − 16 − 2 = **−22** = ΔM.

**Inputs and V2.** Each effect is a function fact (`fn: pvm_margin.v1`, the effect named by its label, §14). Its inputs are the measured per-item facts (`revenue[product=…]`, `units[product=…]`, `cost[product=…]`):

- Volume, mix, price and cost read the common items in groups of six (r₀, q₀, cost₀, r₁, q₁, cost₁).
- New reads pairs (r₁, cost₁), and lost reads pairs (r₀, cost₀).
- Unpriced reads groups of four (r₀, cost₀, r₁, cost₁).

V2 recomputes each effect from its inputs (agent-and-verifier §7). "(other)" is one item, as in `pvm.v1`, so the identity still holds.

**When it runs.** For every material change of `gross_margin` (`period_change.v1`), at that period against its baseline (§2), when the table has `quantity`, a product entity and a cost role. Otherwise the not-run entry is `pvm_margin.v1` with reason `no_cost_role`, `no_quantity_role` or `no_item_dimension`.

**As built (PR 8).**

- *Code.* `pvmMargin` (`packages/analysis/src/pvm-margin.ts`) is pure: items in, one calc per effect out, each calc carrying its fixed fact label (`Calc.factLabel`, so `pvm_margin.cost_2026-03` is the fact's label, not `<context>:<name>`). `marginEffect(effect, inputs)` is the one formula, used by `pvmMargin` to compute the value and by V2 to recompute it from the fact's inputs. The common-item arithmetic is shared with `pvm.v1` (`pvm-kernel.ts`). A base quantity counts as 0 when |Q₀| ≤ 1e-12 × Σ|qᵢ₀|, so floating-point dust from returns is not taken as a base.
- *Inputs* (`decomp-inputs.ts`, `pvmMarginFor`) are read through the metric layer: the revenue term's member series (`revenue`, or `costed_revenue` when some lines have no cost), the `cost` metric and a quantity helper (`gross_margin__qty`) grouped by the item dimension. The dimension is the first of the margin's dimensions with an item role, `product_id` before `product` before `product_group`, so a table with a SKU and a name is split once and the fixed label names one fact. It is not run when an item is the "(other)" bucket, when there is no quantity role or item dimension, or when the items' margins do not add up to the margin metric's own change (an incomplete item set).
- *When.* `gross_margin` is decomposed like an additive metric: contribution by member, and margin PVM, for each material insight that `period_change.v1`, `trend_break.v1`, `anomaly.v1` or `ratio_shift.v1` raises on it. `period_change.v1` looks at the latest period only, so a planted move that is not the latest month and is neither a break nor an anomaly (wholesale-margin-v1's 2026-05 price event, +818.20 against a noise band of the same size) is decomposed only when that month is the latest in the data. Margin members get no per-member findings of their own (no per-member trend or concentration).
- *Values.* With the wholesale-margin-v1 file, 2026-03: volume −26.2943, mix 12.3059, price −325.8516, cost −1,902.0000, sum −2,241.84. With the data cut after 2026-05: volume −220.7209, mix −84.7169, price 1,300.0378, cost −176.4000, sum 818.20 (`packages/verify/test/margin-v2.test.ts`).
- *Margin facts.* A margin value at a period (`gross_margin_<p>`, `gross_margin[<dim>=<member>]_<p>`, `gross_margin_pct_<p>`) is a function fact of the revenue and cost facts of the same period and member (§9) whenever those series exist; it is the SQL fact of the metric when they do not (a member outside the revenue top 50) or when the two do not give the measured value.
- *Not built here.* "Analyses not run" entries (PR 10); the `no_item_dimension` reason; slicing `gross_margin_pct` by member (rate vs mix needs a table term on both sides, and `gross_margin` is derived); the missing-cost quality item cited by `costed_revenue`'s assumption.

**Tests (PR 8):** both cases above and the zero-base case; 200 seeded random cases (mulberry32, fixed seed, 1–12 items, new, lost, unpriced and uncosted items, negative quantities as returns), where the sum of the effects equals ΔM within a relative 1e-9 and V2 recomputes every effect; and a tampered effect (+0.01) that fails V2.

## 11. Pareto, top-N concentration and its trend

These run on one metric: the pack's `revenue` when that is an additive currency metric, else the first metric that is (the objective is not consulted, so the planner tool and the runner always agree on which metric's labels are unqualified). They cover each dimension column whose role is an entity (customer, product, supplier) or `channel`, `location`, `salesperson` or `product_group`. Other metrics and dimensions are reached on demand through the `concentration` planner tool (agent-and-verifier §3).

**Members** are the dimension's values with their metric value over the window, taken from the metric's own member query **without the 50-member cap** of §1. The class counts need every member: Online Retail II has thousands of customers.

- Members with a value ≤ 0 are left out of the curve and counted as their own facts (`nonpositive_count`, `nonpositive_value`).
- Rows with no key (a null customer id) are left out too, with their value as a fact (`unkeyed_value`). Otherwise "(none)" would read as the largest customer.
- Shares are of the positive members' total T.

### 11.1 `pareto.v1`

- **Windows:** the trailing 12 months ending at the report's last period (`ttm`), or the whole range when shorter, and the 12 months before it (`ttm_prev`), computed only when the data covers all 12. At other grains the window is the same calendar span: 4 quarters, 52 weeks, 1 year or 365 days.
- **Curve:** members sorted by value descending, ties by key ascending. The cumulative share Sₖ = (v₁ + … + vₖ) ÷ T × 100.
- **Classes:** A when Sₖ ≤ 80, B when 80 < Sₖ ≤ 95, C when Sₖ > 95. A member is in the class its cumulative share reaches. The first member is always A, so a member that holds more than 80% alone still makes class A. The comparison allows a relative 1e-12 so that a member that reaches exactly 80% or 95% lands on the lower class despite floating-point rounding.
- **Facts per class:** the member count, the value and the share of T. Also stated: the total member count, the non-positive count and value, and the unkeyed value.
- **Computation:** an SQL template (`pareto.sql.ts`: window sums per member, then a window function for the cumulative share). The metric's own grouped query for the window is its source, and the thresholds are parameters. The facts are `sql` facts and cite the metric's rows in the window, like any measured fact. As built, the fact's SQL returns one row per member with its plain group-by total and the statistic as `value` on every row. V2 re-runs the template (the first row's `value`). It also applies the `pareto_class` rule: it takes the totals from the rows (a plain group-by, no window function), sorts and classifies them in TypeScript, and the counts and values must match.

**Hand-computed:** members 50, 30, 10, 6, 4 (T = 100) give cumulative shares 50, 80, 90, 96, 100. A = {50, 30}: 2 members, value 80, 80%. B = {10}: 90 ≤ 95, 1 member, value 10. C = {6, 4}: 96 > 95, 2 members, value 10. With a member −5 added, the curve is unchanged, and the non-positive count is 1 with value −5. Edge case: 85, 10, 5 give 85 (A, the first member), 95 (B, since 95 ≤ 95) and 100 (C).

### 11.2 Top-N shares and HHI

- **Top-N share** = Σ of the N largest members ÷ T × 100, for N = 3, 5 and 10. It is stated only when there are more than N positive members, since otherwise it is trivially 100%.
- **HHI** = Σ sᵢ² over the positive members, with sᵢ = vᵢ ÷ T.
- **Periods:** the latest job period, each complete calendar year in the data (when the grain is finer than a year), and the `ttm` window. The top-1 share and the HHI are also stated for each of the last 36 job periods that have a positive member (§11.3), so a daily series makes 36 facts and not 365.
- **Computation:** an SQL template (`concentration.sql.ts`), as `sql` facts that V2 re-runs. V2 also recomputes them from the member totals in TypeScript (rules `top_n_share` and `hhi`).
- **Hand-computed** on the members above: top-3 share = (50 + 30 + 10) ÷ 100 × 100 = **90%**. HHI = 0.5² + 0.3² + 0.1² + 0.06² + 0.04² = 0.25 + 0.09 + 0.01 + 0.0036 + 0.0016 = **0.3552**.
- **Agreement.** PR 9 moves `concentration.v1` (§3) onto these exact shares: positive members, no cap, and "(other)" not counted as a member. The finding and the section then agree.

### 11.3 Concentration trend

The per-period HHI facts (and the per-period top-1 share facts) of the last 36 periods that have a positive member go through `trend.v1` (§3: Theil–Sen slope, Mann–Kendall p < 0.05, 4+ periods), reusing V2's `theil_sen` and `mann_kendall` rules over those facts. A period with no positive member is left out of the series.

**Hand-computed:** HHI 0.20, 0.22, 0.25, 0.27, 0.30.

- The ten pairwise slopes are 0.02, 0.025, 0.02333…, 0.025, 0.03, 0.025, 0.02666…, 0.02, 0.025 and 0.03. Sorted, the 5th and 6th are both 0.025, so the Theil–Sen slope is **0.025** per period.
- Mann–Kendall: all 10 pairs rise, so S = 10. Var(S) = n(n − 1)(2n + 5) ÷ 18 = 5·4·15 ÷ 18 = 16.667. z = (S − 1) ÷ √Var = 9 ÷ 4.0825 = 2.2045. The two-sided p is **0.0275** < 0.05: a rising trend.

### 11.4 Single-customer dependence (`dependence.v1`)

A `concentration_risk` finding on the customer entity (as built: the pack's first dimension in the order customer, product, supplier, channel, location, salesperson, product group; the business model's lead dimension, semantics §4, is not wired). It fires when the top member's share in the latest period is ≥ 30%, and either of these holds:

1. the top-1 share was below 30% in the first period of the `ttm` window and the HHI trend is rising (p < 0.05); or
2. the top member's own value is shrinking: the Theil–Sen slope of its values over the trend periods is < 0 with Mann–Kendall p < 0.05 (stated only when the member is among the kept member series, which the largest by volume always are).

Its claims cite the share facts, the trend facts and the member's value facts. Analyst-grade's third condition ("also overdue") waits for M16's receivables pack.

## 12. Scorecard

The scorecard is a report section built by code at no model cost, including in small-model mode (analyst-grade §3.5). It is not a list of findings.

- **Rows:** each pack KPI (§8.1), then margin and margin % when they exist, then every other confirmed or assumed sum, count or ratio metric (for example a `period_summary` table's measures), up to 12 rows.
- **Period:** the report's last complete period.
- **Cells**, each a fact:
  - **Value:** the measured fact for the period.
  - **vs baseline:** the change against the previous period, or the trailing mean of 3 when the previous period has no value (§2's rules 2 and 3), and the method. The change Δ is `delta`. Δ% is `pct_change`, stated only when the base is positive (§2). Same-period-last-year is not used here because it has its own column.
  - **vs same period last year:** Δ and Δ% against the period 12 months earlier at month grain, 4 at quarter grain, or 1 at year grain. Otherwise it is n/a with a reason code: `too_few_periods` (fewer than 13 months, 5 quarters or 2 years), or `grain_not_comparable` at week and day grain.
  - **Material:** baselines.ts `materiality()` applied to the baseline change, using the noise band (a fact: `fn: noise_band`, inputs the series' points, the last change left out) and the series mean (a fact: `fn: mean`). It is `null` with fewer than 6 periods (no band). It is a flag, not a number: V2 recomputes it from those facts (agent-and-verifier §7).

**Hand-computed** on coffee-roaster-v1 (`evals/datasets/coffee-roaster-v1/answers.yaml`, months 2026-01 … 2026-06; the last is 2026-06):

| Metric | Value | vs previous (May) | Band | Material | vs last year |
|---|---|---|---|---|---|
| revenue | 37,000 | +1,200; 37,000 ÷ 35,800 − 1 = +3.352% | 3,113.46 | no (\|1,200\| ≤ band; 3.35% < 5%) | n/a, `too_few_periods` |
| orders | 1,040 | +35; +3.483% | 81.543 | no | n/a |
| refund rate | 3.4% | +0.5 pp; 3.4 ÷ 2.9 − 1 = +17.24% | 0.44478 | yes | n/a |

Working for the revenue band:

- The changes between months are +1,700, +1,200, −7,900, −400 and +1,200. The last one is the change being tested, so it is left out.
- The median of the other four is (−400 + 1,200) ÷ 2 = 400. Their absolute deviations are 1,300, 800, 8,300 and 800, with median (800 + 1,300) ÷ 2 = 1,050.
- So the band is 2 × 1.4826 × 1,050 = 3,113.46.

Working for the refund rate:

- The changes are −0.1, +0.2, +0.1 and +1.6, with +0.5 left out. Their median is 0.15, the median absolute deviation is (0.05 + 0.25) ÷ 2 = 0.15, and the band is 2 × 1.4826 × 0.15 = 0.44478.
- \|0.5\| > 0.44478, 17.24% ≥ 5%, and 0.5 ≥ 1% of the mean 1.8167. So the change is material.

**Tests (PR 10):** this table from the dataset's monthly ground truth, the not-run entries for a table with and without cost, an HTML snapshot, and the schema drift check.

**As built (PR 10, `scorecard.ts`).**

- **Rows.** The pack KPIs are matched by id (`revenue`, `orders`, `units`, `aov`, `customers`, `new_customers`, `returning_customers`, `refund_rate`, `cancellation_rate`, `discount_rate`), then `gross_margin` and `gross_margin_pct`, then every other `sum`, `count` or `ratio` metric in the job's order, 12 at most. The margin pack's helper `costed_revenue` has no row. A metric with no value in the period (a ratio over nothing, or a series that ends earlier, such as new customers after the first month) has no row.
- **Period.** The last of the job's periods (the report's `period.to` once a part-month is left out).
- **Baseline.** `chooseBaseline` with `sameLastYear: false`: the previous period, else the trailing mean of 3 (a `trailing_mean_3` fact). With neither, `vs_base` is `{ na: "too_few_periods" }` and `material` is `null`.
- **Band and mean.** Both are computed over the series' finite points up to the period, at most the last 36 of them (`BAND_PERIODS`, the cap of §11.3, so a daily series doesn't cite every day of the data). Those points are the facts' inputs, so V2 recomputes them from the same list; the band leaves out the last change. With fewer than 6 finite points there is no band and `material` is `null`. Δ% is passed to `materiality()` only when it is stated (a positive base); otherwise the change is not material.
- **Year-on-year.** `yoyGap`: `grain_not_comparable` at week and day, `too_few_periods` with fewer than a year of periods plus one (13 months, 5 quarters, 2 years), counted over the job's periods; a year-ago point with no value is `too_few_periods` too.
- **Labels.** `scorecard.<metric>.<vs_base|vs_base_pct|yoy|yoy_pct|band|mean>_<p>` with the metric's own id; the value is the measured fact (`revenue_2026-06`), and a trailing-mean base is `scorecard <metric> <p>:base`.
- On coffee-roaster-v1 the engine's scorecard gives the table above exactly (`packages/analysis/test/scorecard.test.ts`).

## 13. Analyses not run

This is a deterministic list built from each pack's requirements (§8–§12). It costs no model call. Each entry has:

- `analysis`: the id;
- `reason_code`;
- `reason`: one sentence;
- `needs`: the missing roles or kinds.

The `reason` carries **no numerals**: V1's rule applies, so "fewer than 13 months" is written "not enough history for a year-on-year comparison", and the threshold lives in the code.

| analysis | reason_code | When |
|---|---|---|
| `gross_margin`, `pvm_margin.v1` | `no_cost_role` | no `unit_cost` or `cost_amount` |
| `pvm_margin.v1`, `pvm.v1` | `no_quantity_role`, `no_price_role`, `no_item_dimension` | the role is missing |
| `contribution_margin` | `no_variable_cost` | in M15, on every job with a pack revenue (no variable-cost role; a job with no sales has no margin to refine) |
| `pareto.v1`, `concentration` | `no_dimension` | no dimension with an entity or grouping role |
| `pareto.v1` (`ttm_prev`) | `too_few_periods` | the data doesn't cover the 12 months before the window |
| `yoy` | `too_few_periods`, `grain_not_comparable` | §12 |
| `kpi.<id>` (for example `kpi.aov`) | `no_order_id`, `no_customer_role`, `no_quantity_role`, `no_refund_role`, `no_discount_role`, `no_status_role` | the KPI's role is missing (§8.1) |
| `kpi.new_customers` | `no_history` | stated for the first period only |

An analysis that the business model's order skipped is not "not run": every unlocked pack runs.

**As built (PR 10, `not-run.ts`).** `analysesNotRun` builds the list from what the job knows at MEASURE:

- the KPI pack's `notDrafted` list (metrics `salesKpiPack`), drafted again from the roles as they stand (the person's edits included). `gross_margin` with `no_cost_role` (or `no_quantity_role` on the unit-cost path) gives `gross_margin` and `pvm_margin.v1`; any other KPI gives `kpi.<id>`. A KPI the person defined themselves (its id is a job metric) is left out;
- `gross_margin` and `pvm_margin.v1` with `no_cost_role` also when no column of the job, in any table, has a cost role (`profile_roles` as confirmed), even when no sales pack was drafted: a table with a year and a month column has no pack yet (Montgomery's G3, Online Retail II's G14). A `gross_margin` job metric leaves both out;
- price–volume–mix on the pack's revenue (`packMetric`, a sum): `pvm.v1` (and `pvm_margin.v1` when margin exists) with `no_quantity_role` or `no_item_dimension` (`pvmReadiness`). PVM's price is revenue ÷ quantity (§4.2), so `no_price_role` is never stated;
- `contribution_margin` with `no_variable_cost` whenever the job has a pack revenue;
- the Pareto pack's `no_dimension` (`pareto.v1`, `concentration`) and `pareto.v1` `too_few_periods` (no year before the trailing year);
- `yoy` by §12's rule over the job's periods, and `kpi.new_customers` `no_history` when the job has a single period.

Each reason is a fixed sentence per reason code (a KPI's reason starts with its name), with no numerals; `needs` lists the roles. Entries are unique by analysis and reason. The list travels in the MEASURE stage output to the report (`analyses_not_run`) and to EXPLAIN's fact sheet.

## 14. Fact labels

Labels are fixed here so that golden items (accuracy §1) and the report can name facts before the engine produces them. `<p>` is a period at the job grain (`2026-03`, `2025-Q4`), or a calendar year (`2019`). Fact labels end with their period, so V1's bare-year rule (`periodYears`) keeps working. `<dim>` is the entity (`customer`, `product`, `supplier`) or the role (`channel`, `location`, `salesperson`, `product_group`). When two columns of a table hold the same one, the second is `<dim>~<column>`.

| Fact | Label | Example |
|---|---|---|
| a measured metric (unchanged) | `<metric>_<p>`, `<metric>[<dimension>=<member>]_<p>` | `revenue_2010-11`, `aov_2010-11` |
| gross margin, margin %, cost | `gross_margin_<p>`, `gross_margin_pct_<p>`, `cost_<p>`, with `[<dimension>=<member>]` per member | `gross_margin_2026-03`, `gross_margin_pct[product=A]_2026-04` |
| a margin PVM effect | `pvm_margin.<effect>_<p>`, effect ∈ volume, mix, price, cost, new, lost, unpriced; `<p>` is the later period | `pvm_margin.cost_2026-04` |
| a Pareto class | `pareto.<a\|b\|c>_<count\|value\|share>.<dim>_<ttm\|ttm_prev>` | `pareto.a_count.customer_ttm` |
| the Pareto extras | `pareto.members.<dim>_<w>`, `pareto.nonpositive_count.<dim>_<w>`, `pareto.nonpositive_value.<dim>_<w>`, `pareto.unkeyed_value.<dim>_<w>` | `pareto.unkeyed_value.customer_ttm` |
| a top-N share | `top<1\|3\|5\|10>_share.<dim>_<p\|ttm>` | `top5_share.supplier_2019` |
| HHI | `hhi.<dim>_<p\|ttm>` | `hhi.supplier_2019-07` |
| the concentration trend | `hhi.<dim>.trend.slope`, `hhi.<dim>.trend.p_value`; `top1_share.<dim>.trend.slope`, `top1_share.<dim>.trend.p_value` | `hhi.supplier.trend.slope` |
| a scorecard cell | `scorecard.<metric>.<vs_base\|vs_base_pct\|yoy\|yoy_pct\|band\|mean>_<p>` | `scorecard.revenue.vs_base_pct_2026-06` |
| a `concentration` tool result | the labels above with `_<from>_<to>` for an arbitrary range, `_<year>` when the range is exactly a calendar year, and `_<p>` for one period; a fact that already exists under the label is reused, not made again | `top3_share.customer_2011-01_2011-06` |
| a role identity rate | `role_identity.<gross\|net\|margin\|dates\|balance>.<table>` | `role_identity.net.t_orders` |

- **Unqualified margin labels** belong to the report's margin metric (`gross_margin`). A second margin metric (another table) uses its own metric id in place of `gross_margin`, and `pvm_margin.<effect>[<metric>]_<p>` for its PVM.
- **A confirmed metric keeps its id.** When dedupe (§8.1) keeps the user's id for a pack KPI (hotel bookings' `room_revenue` for `revenue`), the labels use that id.
- **A dimension of a metric that is not the pack's** is `<dim>[<metric>]` in these labels (`top3_share.customer[units]_2019`), so two metrics never share a label.
- **Uniqueness.** Each label in this section names one fact in a report. The factbook refuses to create a second fact with one of these labels and a different value (an engine bug, like a V2 mismatch).
