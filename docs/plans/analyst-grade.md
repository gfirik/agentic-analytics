# Analyst-grade analysis: plan

**Status: DRAFT for the maintainer's review. Nothing in this plan is built yet.** It proposes milestones M14–M20; each starts only after the maintainer approves it.

## 0. Goal

The engine should analyze a business the way a senior business analyst would, with high, measured accuracy. "Analyst-grade" means four things, each of which can be checked:

1. **Coverage.** It runs the analyses a senior analyst would run on the data it was given: KPIs, breakdowns, margin, working capital, customers, drivers, forecasts, scenarios and the market. It also says which ones it could not run and why.
2. **Correctness.** Every number is right. Each one is computed in SQL or code and recomputed by the verifier, as today. Every *conclusion* is right too: the driver, the cause grade, the period and the comparison. This is measured against answers that people wrote and reviewed.
3. **Stability.** The same job run five times reaches the same conclusions.
4. **Added value, proven.** The same model does measurably better with the engine than without it, on the same tasks.

The rules that make the engine trustworthy stay as they are (AGENTS.md §2):
- the model never does arithmetic;
- every claim carries provenance;
- untrusted text is quarantined;
- there is no free-form code;
- models are free and local first.

Each new capability below follows one pattern:

- **Deterministic first.** Detection and computation are SQL templates (`.sql.ts`) or pure functions in `packages/analysis`, each with a hand-computed test. Each emits facts with a `computation` record.
- **The model interprets only.** It does three things:
  1. picks between analyses the code has already found applicable, when there is a real choice;
  2. explains, with documents and external context;
  3. writes, with placeholders.
- **Verifier coverage.** Every new function gets a V2 recompute rule. Every new kind of claim gets a V1/V4 check. Nothing new ships with an unverified number.
- **Graceful absence.** When the data can't support an analysis (no cost column, no due dates, too few periods), the report says so in an "Analyses not run" list, with the reason. It never guesses.

## 1. Where the engine stands (2026-10-19)

The engine already does these well, each with verifier coverage and hand-computed tests:
- period-over-period change with baseline choice and materiality;
- trends and trend breaks;
- anomalies (robust z);
- additive contribution;
- price–volume–mix;
- rate–mix for ratio metrics;
- top-1 concentration and HHI;
- new and lost members;
- a seasonal spike guard;
- impact ranking;
- four bounded impact scenarios;
- dated checks;
- a sanitized web lane with External labelling;
- a profile-based data-quality pass.

(File references in §2.)

The structural gap is **business semantics**. The engine knows tables, columns, metrics and dimensions, but not what kind of business document a table is. It can't tell an invoice register from a stock count, or a cost column from a price column. So it cannot compute margin, aging, turnover, cohorts or cash flow. The metric drafting prompt lists margin and inventory days (`packages/metrics/src/draft.ts:13-25`), but only as suggestions to the model. No code computes them. Most of the gaps in §2 follow from this one.

Measurement is the other gap:
- **Real data:** the real-data tier has two datasets (12 checks).
- **Synthetic suite:** the offline baseline is tuned on the same 30 synthetic businesses it is scored on, and there is no held-out set.
- **Real models:** they have finished the smoke suite and 8 of the 30 businesses.
- **Never measured:** stability across runs, and the engine's added value over the model alone.

## 2. Capability map

Legend for **Today**:
- **Yes:** built, verified and tested.
- **Partial:** some of it is built.
- **No:** not built.

**Design** is the proposal. Unless a row says otherwise, "V2 rule" means the verifier re-runs the function or SQL from the fact's inputs.

### 2.1 Cross-cutting: business semantics (prerequisite for most rows below)

| Capability | Today | Gap | Design |
|---|---|---|---|
| Column roles | **Partial.** Profile types columns; `fallbackMetrics` guesses a money column and qty × price (`packages/metrics/src/draft.ts:198-267`); runner regexes `QTY`/`ITEM` for PVM (`packages/analysis/src/runner.ts:88-89`). | No notion of cost, unit cost, discount, tax, due date, paid date, stock on hand, customer id vs order id, SKU, location. | `packages/profile` gains a **role detector**: deterministic scores from names (multilingual synonyms list), types, value patterns (dates after an invoice date → due date), and cross-column identities (`qty × unit_price ≈ amount` on ≥ 95% of rows, checked in SQL). Roles are proposed with evidence and confirmed like metrics (AWAIT_CONFIRM; `--yes` keeps them as assumptions). The model may only break ties between candidates the code produced. |
| Table kinds | **No.** | Can't tell sales lines from an invoice register, AP bills, stock snapshots, a bank export or a GL. | A **table-kind classifier** from roles: sales lines (date, amount, ±qty, product/customer), invoices (invoice id, issue date, due date, ±paid date/amount), bills (same, payable side), inventory snapshots (date, SKU, on-hand), bank/cash (date, signed amount, balance), budget/plan (period, metric, target). Each kind unlocks an **analysis pack** (§3). |
| Business model | **No.** | Retail vs wholesale vs subscription vs services changes which KPIs matter. | Inferred from table kinds and roles (recurring customer-month revenue → subscription signals), shown as an assumption, editable in the confirm step. Only changes which packs run and their order; never a number. |

### 2.2 Descriptive

| Capability | Today | Gap | Design |
|---|---|---|---|
| KPI computation | **Yes** for sum/count/count_distinct/avg/ratio/derived metrics: schema `packages/schema/src/metric.ts:6-49`, compiler `packages/metrics/src/compile.ts:222-260`; V2/V4 re-run and compare SQL to the definition (`packages/verify/src/verify.ts:186-276`). | KPIs beyond revenue/orders/refund rate depend on the model drafting them; no standard KPI set per business. | A **KPI pack per table kind**: sales (revenue, orders, units, AOV, customers, new vs returning, refund rate, discount rate), gross margin when cost exists, AR/AP/inventory KPIs (below). Drafted by code from roles, so a small model can't miss them; the model may add business-specific ones. A **scorecard** section: each KPI, latest period, vs baseline, vs same period last year, with materiality from `baselines.ts`. |
| Trends, period change | **Yes**: `period_change.v1`, `trend.v1` (Theil–Sen + Mann–Kendall), `trend_break.v1` (`packages/analysis/src/templates.ts:70-238`), baseline choice (`baselines.ts:24-93`). | Fine as is. Missing: year-to-date and trailing-twelve-month views analysts use for seasonal businesses. | `ytd.v1` and `ttm.v1` templates (SQL window sums), V2 `sum` rule. |
| Breakdowns (customer, product, channel, region) | **Yes**: every additive metric per dimension, top 50 + "(other)" (`runner.ts:123-161`); `drill_down` tool (`packages/analysis/src/slice.ts:95-182`). | Ratio and avg metrics are not sliced (`runner.ts:123`); no two-dimension cross-tabs; `drill_down` takes no filter (`packages/agent/src/tools.ts:144`). | Slice ratio metrics by slicing numerator and denominator (same SQL, recomputed by V2); 2-D cross-tab template for the top driver's dimension × one other; a filter parameter on `drill_down` restricted to confirmed dimension members (parameterized, never interpolated). |
| Margin (gross, contribution) | **No**: prompt hint only (`draft.ts:18`). | Can't answer "are we making money on this product/customer". | With a cost or unit-cost role: `gross_margin`, `gross_margin_pct` derived metrics drafted by code; margin by product/customer/channel; margin PVM (price, volume, mix, **cost** effect) as `pvm_margin.v1` extending `pvm` (`packages/analysis/src/decompose.ts:106-166`) with a cost-per-unit effect; identity test on ≥ 20 random cases like `pvm`. Without cost: listed under "Analyses not run: no cost column". |
| Inventory turnover | **No**: prompt hint only (`draft.ts:24`). | No stock analysis. | With an inventory-snapshot table (or opening/closing stock + COGS): turnover = COGS ÷ average inventory, days of inventory (DSI), stock-outs (on-hand = 0 periods), dead stock (no sales in N periods with on-hand > 0), over-stock vs sales velocity. SQL templates, V2 `sum`/`ratio` rules. |
| AR / AP aging | **No.** | Can't see who owes what or how late. | With an invoice (or bill) table: aging buckets (current, 1–30, 31–60, 61–90, 90+ days past due) as of the data's end date, DSO/DPO, top overdue accounts, collection-rate trend, concentration of overdue. `aging.v1` SQL template with the as-of date as a parameter; V2 re-runs it; every bucket total cites its invoice rows. |
| Cash flow | **No.** | No inflow/outflow, burn or runway. | With a bank/cash table: monthly inflow, outflow, net, closing balance (checked against the file's balance column when present: a reconciliation fact), trailing burn, runway = balance ÷ trailing net burn (only when burn > 0, stated as a run-rate, not a forecast). |
| Unit economics | **Partial**: AOV only as a hint (`draft.ts:16`). | No CAC, LTV, payback, contribution per order. | AOV, units per order, revenue per customer by code. LTV only from observed cohort revenue (sum over the observed window, never extrapolated without the predictive pack). CAC and payback only when a marketing-spend table exists, matched by period; otherwise listed as not run. |
| Cohorts and retention | **No**: `new_lost.v1` is the nearest (`templates.ts:376-421`). | No acquisition cohorts, retention curves, GRR/NRR. | With a customer id and dates: monthly acquisition cohorts, customer and revenue retention by months-since-first-purchase (triangle as SQL), repeat-purchase rate, GRR/NRR for subscription-like data, RFM segments. `cohort.v1` template; V2 recompute of each cell used by a claim; findings when a recent cohort retains materially worse than the median of earlier ones (same materiality rule as `baselines.ts`). |
| ABC / Pareto | **No.** | Analysts always ask "which 20% of products/customers make 80% of revenue". | `pareto.v1`: cumulative share curve, A/B/C classes at 80/95%, count of members per class, per dimension; V2 `share` rule. Feeds concentration findings and inventory (C-class dead stock). |
| Concentration risk | **Partial**: top-1 share and HHI (`templates.ts:332-371`, `packages/analysis/src/stats.ts:86`). | No top-N share, no trend in concentration, no link to margin/overdue. | Top-3/top-5/top-10 share, HHI trend over periods, "single-customer dependence" finding when the top customer's share rises past 30% and is also overdue or shrinking. Reuses V2 `share`/`hhi`. |

### 2.3 Diagnostic

| Capability | Today | Gap | Design |
|---|---|---|---|
| Driver decomposition | **Yes**: `contribution.v1` over every dimension (`decompose.ts:28-70`, `runner.ts:221-263`). | Only one dimension at a time; no driver tree for derived metrics. | **Driver trees**: revenue = orders × AOV, AOV = units/order × price/unit, margin = revenue − cost, with multiplicative splits by the LMDI method (exact, order-independent) as `lmdi.v1`; identity tests. The existing `shapley.v1` spec item (`docs/specs/analysis-library.md` §4.5) covers ≤ 6 non-additive factors. Two-dimension drill on the top driver (channel → customer). |
| Price–volume–mix | **Yes**: `pvm` (`decompose.ts:106-166`), run when a quantity column and an item dimension exist (`runner.ts:428-484`). | Name-based column detection; no cost effect; no PVM by customer. | Use confirmed roles instead of regexes; margin PVM (above); PVM over customer × product when both exist. |
| Mix effects | **Yes**: `mix_shift.v1` (`templates.ts:426-467`), `ratemix.v1` (`decompose.ts:214-286`). | Fine as is. | No change beyond roles. |
| Simpson's paradox | **Partial**: `simpsonRisk` computed (`decompose.ts:269-284`) and stored in `details.simpson_risk` (`runner.ts:384`), read by nothing; ratio metrics only. | The flag never reaches the report; additive metrics with mix shifts can mislead too. | Surface it: a finding caveat ("the overall rate fell while most segments rose: the mix moved") that V4 checks against the stored flag; the EXPLAIN form must present the segment story when the flag is set (spec §4.3 already says so). Add Simpson setups to the generator (`docs/EVALS.md:39` lists them as not generated). |
| Anomalies vs seasonality | **Partial**: `anomaly.v1` robust z (`templates.ts:247-296`); seasonal spike guard (`packages/analysis/src/seasonal.ts:42-81`); `diff.v1` built and tested but never called (`decompose.ts:309-354`). | No seasonal expectation: an anomaly is judged against neighbours, not against "what this month usually looks like". | `seasonal_expect.v1`: expected value = seasonal naive (same period last year × trailing YoY growth) with a band from the residuals of past years; an anomaly is material only outside the band. Needs ≥ 2 years; with less, today's guard stays. Wire `diff.v1` for count/rate anomalies so each anomaly names its 1–2 attribute combinations. |
| Statistical significance | **Partial**: materiality is a noise band; `ratio_shift`'s two-proportion test never gets counts (`runner.ts:171`). | Rate changes on small counts can be noise. | Pass counts to `ratio_shift.v1` and add the missing V2 rule for `two_proportion_z`. Small-sample findings get the existing low-confidence weight in ranking. |

### 2.4 Predictive

| Capability | Today | Gap | Design |
|---|---|---|---|
| Forecasts with intervals | **No**, and ruled out: "The engine never gives point forecasts" (`docs/specs/analysis-library.md` §5; `packages/analysis/src/impact.ts:1`). | Analysts are asked "where will we land this quarter". | **Needs a maintainer decision (spec change).** Proposal: intervals only, never a point. Methods: seasonal naive and ETS (Holt–Winters additive) in pure TS, chosen by rolling-origin backtest; 80% and 95% intervals from empirical backtest residual quantiles (no distributional assumption). A forecast is shown only when its backtest beats seasonal naive on MASE; otherwise "not forecastable from this history". Every forecast stores method, parameters, backtest window and MASE as facts; V2 re-fits deterministically (fixed optimizer, fixed seed) and must match within 1e-9. Labelled "forecast, 80% interval" in the report. |
| Run-rate | **No.** | "At this pace, the year ends at…" | `run_rate.v1`: YTD ÷ elapsed share of the year, and seasonally adjusted run-rate (YTD ÷ last year's YTD share) when ≥ 1 prior year exists; both always shown together with their formula. V2 rule. |

### 2.5 Prescriptive

| Capability | Today | Gap | Design |
|---|---|---|---|
| Ranked actions with impact | **Yes**: DECIDE (`packages/agent/src/decide.ts:120-251`), score = mean impact × confidence ÷ effort (`decide.ts:215`); impact scenarios with bounds (`impact.ts:47-166`); V7 cascade (`verify.ts:346-401`). | Four scenario types; the model picks among them. | New scenario types tied to the new packs: `collect_overdue` (AR: share of 60+ bucket collected), `clear_dead_stock` (inventory: value at a markdown range), `reprice_low_margin` (margin: price change on C-margin items with volume held or elastic), `win_back_cohort` (retention: recover a share of a cohort's lost revenue). Same rules: parameters from an allowed range, justified by findings, computed in code, V2-checked. |
| What-if and price/volume sensitivity | **Partial**: `price_change` only, volume held constant (`impact.ts:33,121`). | No elasticity, no multi-lever scenarios, no break-even. | `sensitivity.v1`: a grid of price change × volume response (elasticity range, default −0.5 to −2.0 stated as an assumption, or estimated from the data only when price varied enough within an item: log-log slope with its interval, never used when the interval spans 0); break-even volume for a price change; margin-aware. Shown as a small table, every cell a fact. Multi-lever scenarios sum independent lever effects only when the levers touch disjoint revenue (checked in code); otherwise refused. |
| Dated checks | **Yes**: `check` with metric, comparator, threshold fact and date (`decide.ts:50-55`); V7 checks the date and threshold (`verify.ts:375-389`). | Nothing ever evaluates a check against later data. | `aa check <old-job> <new-files>`: re-runs the check's metric definition on the new data and reports met / not met / not yet due, with the new fact. Closes the loop and later feeds impact calibration (spec P2). |

### 2.6 External (web lane)

| Capability | Today | Gap | Design |
|---|---|---|---|
| Web lane and labelling | **Yes**: `webSearch` sanitize → SearXNG → safe fetch (`packages/web/src/lane.ts:38-69`, `sanitize.ts:140-178`, `fetch.ts:52-164`); `external` sources and `external_quote` facts, taint (`packages/analysis/src/slice.ts:334-407`); V8 (`verify.ts:278-286`); `benchmark_gap.v1` for percent ranges (`templates.ts:514-543`). | Only free-form "industry benchmark" search; only percent ranges parse. | Keep every existing rule (External label, taint, sanitizer, quarantined extraction). |
| Competitor pricing and positioning | **No.** | "What do competitors charge for this?" | `research_competitors` tool with **templated queries only**: `{product category} price {region}` and `{competitor name} {product category}`; competitor names come from the user (`--competitors`) or from the quarantined document extracts, never from the private-term list (the sanitizer still strips the business's own names). The extractor returns `{competitor, item, price, currency, url, quote}`; each price is an `external_quote` fact parsed from the quote (V2 re-parses, like `parseQuotedRange`, `slice.ts:315`). Output: a "Market context" section, every row labelled External with URL and quote, never mixed into own-number facts (existing taint). |
| Market benchmarks | **Partial**: percent-range benchmark gap only. | No money or count benchmarks, no source quality signal. | Extend the parser to money and count ranges with units; prefer sources by kind (statistics office, trade association) through a small allowlist that ranks but never excludes; each benchmark shows its publication date when the page states one, and stale (> 3 years) benchmarks are labelled so. Opt-in (`--web`), as today. |

### 2.7 Data quality

| Capability | Today | Gap | Design |
|---|---|---|---|
| Detected issues | **Yes**: unit errors, negative quantities, rates over 100%, future dates, missing ids, missing values, prefixed ids (`packages/profile/src/rules.ts:37-160`); ingest issues (duplicate files, hidden sheets, unparseable values, mixed currency, ambiguous dates; `packages/ingest/src/ingest.ts`); partial last month dropped (`packages/profile/src/periods.ts:14-26`). | Duplicate rows, MAD outliers and missing periods are computed (`packages/profile/src/profile.sql.ts:19-47`) but never raised; the `data_quality` finding type exists (`packages/schema/src/report.ts:91`) and nothing emits it. | Raise duplicates, outliers and gaps as quality items with SQL count facts (like `packages/agent/src/quality.sql.ts:9-24`). |
| Reconciliation | **No.** | Analysts tie totals out before trusting anything. | `reconcile.v1`: sum of lines vs a totals row or a second file (invoice lines vs invoice header; sales export vs bank deposits by month), referential integrity (orders whose customer isn't in the customer table), stale data (newest date far before `--today`). Each mismatch is a fact with both sides cited. |
| Quality affects conclusions | **Partial**: unit-error periods withhold insights (`packages/analysis/src/quality-guard.ts:22-78`). | Other issues don't lower confidence. | A per-table quality score (share of rows with any issue) feeds the confidence weight in ranking and a caveat on findings that read affected rows. |

## 3. Architecture changes

1. **Roles and table kinds** (2.1) are stored in the workspace next to the profile, shown in the confirm step with their evidence, and recorded in `report.json` (schema addition, generated JSON Schema).
2. **Analysis packs.** A pack is a fixed list of templates that a set of roles or table kinds unlocks. The packs are sales, margin, customers, receivables, payables, inventory, cash, forecast and market. The runner (`packages/analysis/src/runner.ts`) runs every unlocked pack. Ranking (`rank.ts`) stays the single place that decides what reaches EXPLAIN. Each pack has its own spec section in `docs/specs/analysis-library.md` before code is written.
3. **Report sections.** These are added to `report.json` and the HTML:
   - a KPI scorecard;
   - per-pack sections (Receivables, Inventory, and so on), shown only when the pack ran;
   - "Analyses not run" with reasons;
   - "Market context" (External).

   The findings and recommendations structure is unchanged.
4. **Verifier.**
   - Every new function gets a V2 rule (the hand-computed test also runs through V2).
   - V4 gains role checks: a margin claim must read a confirmed cost role.
   - A new **V9** checks forecasts: the interval and method come from stored facts, a forecast claim names its interval, and no forecast appears without a passing backtest.
   - V8 extends to market facts.
5. **The model's job stays narrow.** It confirms ambiguous roles (only among the code's candidates), picks scenarios, explains with documents and the web, and writes. Small-model mode keeps its budgets. Packs add facts, not model calls, except one optional EXPLAIN slot per pack section.

## 4. Accuracy program

### 4.1 Real public datasets

The aim is four to six new datasets, each from a different industry, chosen for the analyses they can test. Each one is added like the existing two (`evals/real/`):
- a fetch script (data is never committed);
- the licence and attribution in the README and in `evals/real/answers/*.yaml`;
- answers established by SQL written separately from the engine.

The shortlist and its licence checks are in §4.1a.

### 4.1a Dataset shortlist

Each licence was read on the publisher's own page (2026-10-19), not on a mirror. The fetch script re-checks the licence text before every download. Row counts and spans marked "verify" are confirmed on the first download.

| # | Dataset (publisher) | Industry | Licence (publisher's words) | Shape | What it tests |
|---|---|---|---|---|---|
| 1 | Hotel booking demand (António, Almeida & Nunes, *Data in Brief* 22, 2019; doi:10.1016/j.dib.2018.11.126) | Hospitality | "open access article under the CC BY license"; the data is supplied with the article (CC BY 4.0) | 2 CSVs, 40,060 + 79,330 bookings, Jul 2015–Aug 2017 | Seasonality, cancellation rate by channel/segment/deposit type, ADR × room-nights (rate/volume split), agent concentration. Real mess: "NULL" agents, a negative ADR and an extreme outlier, a status date that leaks the outcome. Use the article's supplement, not the Kaggle mirror. |
| 2 | English Prescribing Dataset, SNOMED version (NHS Business Services Authority) | Pharmacy / primary care | "Open Government Licence 3.0 (United Kingdom)" | Monthly, practice × drug, 2014– (millions of rows a month; we take one ICB's slice through the portal's SQL API) | PVM on items, quantity and cost; drivers by practice and chemical; seasonality (antibiotics); new and discontinued products; renamed organisations and closed practices. NHSBSA asks (not as a licence term) to be told when figures are published. |
| 3 | Warehouse and Retail Sales (Montgomery County, Maryland) | Beverage wholesale + retail | Socrata metadata: `license: Public Domain`, attribution "Montgomery County, MD" (archived with the fetch) | ~341k rows, item × supplier × month, 2017– (gaps: verify) | Wholesale vs retail channel mix, supplier concentration (top-N, HHI), item-type mix, transfers vs sales as an inventory-flow proxy, December peaks, negative adjustments. No price column, so no PVM. |
| 4 | EIA-861M monthly electricity sales and revenue (US Energy Information Administration) | Utilities / energy | "U.S. government publications are in the public domain and are not subject to copyright protection." | Monthly from 1990, state × sector: revenue, MWh, customers | True price × volume (price = revenue ÷ MWh, cross-checked against EIA's published average prices), strong seasonality, customer counts, drivers by state and sector. Real mess: multi-row Excel headers, adjustment rows, preliminary vs final revisions. |
| 5 | Spending over £25,000 (HM Revenue & Customs, GOV.UK) | Public sector / accounts payable | "All content is available under the Open Government Licence v3.0, except where otherwise stated." | One file a month, 2010– (one line per payment) | Supplier concentration and its trend, spend drivers by expense type, March year-end spikes, credit notes (negatives), header and format drift over 15 years. No invoice or due dates, so it tests payables *concentration*, not aging. |
| 6 | Seoul Bike Sharing Demand (UCI Machine Learning Repository; doi:10.24432/C5F62R) | Transport / mobility | "licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license" | 8,760 hourly rows, ~1 year (verify) | Drivers against weather, hour and holidays, seasonality, anomaly days, and outage days ("Functioning Day = No") that must not be reported as demand drops. Counts only, no revenue. |

**Rejected:**
- **Olist e-commerce:** CC BY-NC-SA, so non-commercial.
- **NYC TLC trips:** no licence is stated, and the city's terms let it revoke use.
- **Cook County invoice register:** no licence field, and no invoice or due dates.
- **Iowa liquor sales:** the licence can't be verified on the publisher's site.

**Gaps the research found:**
- **Real AR/AP data with invoice, due and paid dates:** none exists under a clean licence. Councils publish payment dates only. Aging (M16) is therefore tested on generated businesses and hand-built fixtures, and on HMRC payments only for concentration.
- **Real SaaS subscription data:** none. Retention (M17) uses Online Retail II's customer ids (real) plus generated subscription businesses.
- **Restaurant transaction data:** none. No transaction-level restaurant dataset with clear provenance and a clean licence was found.

**First wave (M14):**
- **Hotel bookings:** real mess, and both cancellations and seasonality.
- **EIA-861M:** true PVM, public domain.

**Second wave (M15–M16):**
- NHSBSA prescribing;
- Montgomery County sales;
- HMRC spending;
- Seoul bikes.

### 4.1b External benchmark

DABstep (Adyen; CC BY 4.0) has 450 multi-step questions with exact answers, over a payments-and-fees dataset. That is close to our domain, and it has a public leaderboard. Running the engine on its tasks (through `aa ask`) gives an outside, comparable accuracy figure. It joins the release run in M21.

Other benchmarks considered:
- **BIRD** (CC BY-SA 4.0): fits the SQL layer only. Its share-alike terms mean it stays in its own folder.
- **InfiAgent-DABench and DSBench:** rejected; both are non-commercial.
- **DA-Code:** rejected; it tests free-form code, which the engine forbids.

### 4.2 Golden set (hand-reviewed)

- **Per dataset, 20–30 analyst questions** spread over the capability map. Examples:
  - "Which month had the highest revenue in 2011?"
  - "What share of revenue came from the top 10 customers?"
  - "How much was 60+ days overdue at the end?"
  - "Did the January fall exceed the usual January fall?"
- **Expected answers:**
  - each question's expected answer and tolerance comes from SQL in `evals/golden/<dataset>/answers.sql`, written by a different person or session than the template code;
  - each answer is **reviewed by a human** (the maintainer, or an outside analyst) and signed off in the file (`reviewed_by`, `date`);
  - unreviewed items don't count toward the bars.
- **Trap items, about 20%:** questions the data cannot answer (no cost column → "margin can't be computed"), seasonal non-events, and partial periods. The right answer is a refusal or a caveat.
- **Scoring:**
  - numeric answers must match within the stated tolerance, read from the report's facts;
  - categorical answers (which month, which driver) must match exactly;
  - trap items pass only on refusal or caveat.
- **Question access:** the engine answers through `aa ask` against the job, or through the report directly when the question maps to a standard section. A question never reaches the engine before the report is built, so the report can't be tuned to the questions.
- **Held-out split:** 30% of golden items are never looked at while building (kept in a separate file and scored only in release runs).

### 4.3 Repeated-run consistency

- `aa eval --repeat 5` runs each job five times with the same model. The response cache is off for this run (each call is live) and the temperature is the provider's default.
- **Agreement measures:**
  - **(a) numbers:** every fact value identical across runs, expected to be 100% because facts are deterministic;
  - **(b) findings:** the same top-5 findings by (template, metric, period, member);
  - **(c) driver:** the same top driver per finding;
  - **(d) cause grade:** the same grade;
  - **(e) action:** the same top recommendation scenario type.
- **Reported value:** the share of jobs where all five runs agree, per measure.
- Disagreements are written out side by side so they can be fixed (usually by moving a choice from the model into code).

### 4.4 Several free models

Every release run covers at least three model families. The proposal:
1. Qwen3.8-27B: on Groq's free tier, and self-hosted through vLLM on Kaggle (the notebook from #27).
2. gpt-oss-120b on Groq or OpenRouter free.
3. A Llama, Mistral or Gemma family model from a free tier.
4. One local model through Ollama that fits a 16 GB laptop, as the floor (qwen3.5:9b today).

Results are published per model, with hardware and cost, as `evals/RESULTS.md` does today.

### 4.5 Ablation: the same model with and without the engine

The goal is to prove that the engine adds accuracy rather than assert it. All arms below use the same tasks (golden questions and planted events), the same model and the same scoring:

| Arm | What the model gets | Stands for |
|---|---|---|
| A. Model alone | The files as text (CSV rows; the PDF, DOCX and EML text), truncated to the model's context window with a stated cut, and the question | A chat assistant with uploads |
| B. Model + SQL | A DuckDB of the same tables and one `run_sql` tool, the question, no metric layer, no verifier | A typical text-to-SQL "AI analyst" |
| C. The engine | The full pipeline | This project |

**What is measured:**
- **Numeric accuracy:** a number in the answer is correct when it matches the golden answer within tolerance. In arms A and B, numbers are extracted from the prose by a deterministic parser.
- **Unsupported-number rate:** numbers that match nothing in the data or the golden set.
- **Driver accuracy.**
- **Planted recall@5 and the distractor false-positive rate,** on the synthetic suite.
- **Trap-item pass rate.**
- **Citation validity:** in arm B, a "citation" is the SQL it ran.
- **Tokens and time.**

**How the comparison is made:**
- Differences are paired by task.
- A paired bootstrap (10,000 resamples, fixed seed) gives each difference a 95% interval.
- The claim "the engine adds accuracy" is made only when the interval excludes 0.

**Fairness:**
- Arms A and B get a strong, published system prompt and the same retry budget.
- A model that can't call tools is run in arm A only.

### 4.6 The synthetic suite's place

The 30 generated businesses stay as the nightly regression check (`scripts/eval-daily.sh`). Two changes:
- **A held-out generated set:** new seeds, and two archetypes the heuristics have never seen. It answers the M13a caveat that the offline baseline is tuned on the same 30 businesses (docs/progress/STATE.md, M13a row).
- **New planted events for the new packs:**
  - Simpson setups;
  - a concentration build-up;
  - an AR slowdown;
  - a dead-stock build-up;
  - a cohort that retains worse;
  - a margin squeeze where revenue is flat.

### 4.7 Launch bars ("ready to launch")

All of these must hold on the release run. Each is reported for the best free hosted model and for the local floor model separately; the bars apply to the best free hosted model unless stated.

| Measure | Bar |
|---|---|
| Number mismatches (verifier), every run of every model | 0 |
| Golden set, numeric and categorical items (held-out split) | ≥ 90% correct (best free model); ≥ 75% (local floor model) |
| Golden set, trap items | ≥ 95% correctly refused or caveated |
| Planted recall@5 with the right driver, **held-out** synthetic set | ≥ 80% |
| Distractor false-positive rate, held-out synthetic set | ≤ 10% |
| Real-data tier checks (all datasets) | 100% pass |
| Consistency over 5 runs: numbers / top findings / driver / cause grade / top action | 100% / ≥ 95% / ≥ 95% / ≥ 90% / ≥ 90% of jobs |
| Ablation, engine vs model alone and vs model + SQL, same model | Numeric accuracy higher by ≥ 20 pp vs each, unsupported-number rate ≤ ⅕ of each, both with 95% intervals excluding 0, on ≥ 2 model families |
| Citation precision / definition adherence / recommendation grounding | ≥ 95% / 100% / 100% (today's bars, docs/EVALS.md) |
| Capability coverage | Every pack in §3 exercised by ≥ 1 real dataset and ≥ 3 golden items |
| Human review | 20 reports across ≥ 4 datasets graded by a reviewer on correctness, usefulness and actionability (1–5): mean ≥ 4, no report below 3 on correctness |

## 5. Milestones (ordered by impact)

The order puts measurement first, so every later milestone shows its effect in numbers. Next come the semantics that unlock most of the map, then the analyses that matter most to a small business (margin, cash and receivables, customers), then depth, prediction, prescription and the market.

### M14 Measurement foundation
**Scope:**
- the golden-set format and scorer;
- golden sets for the two existing real datasets, plus two new datasets from §4.1a (hotel bookings, EIA-861M);
- `aa eval --repeat N` for consistency;
- ablation arms A and B (`evals/ablation/`);
- the paired bootstrap;
- a held-out generated set;
- the multi-model matrix runner.

**Acceptance:**
- the scorer and the bootstrap have hand-computed tests;
- the whole harness runs offline with FakeModel in CI;
- a baseline report records today's engine on golden v1 (scripted and at least one free model), consistency over 5 runs on smoke, and the ablation on smoke and golden v1;
- the results are published as they are, gaps included.

### M15 Business semantics and the KPI scorecard
**Scope:**
- the role detector and table-kind classifier, with confirmation;
- the sales KPI pack drafted by code;
- margin and margin PVM;
- the scorecard;
- ABC/Pareto, plus top-N concentration and its trend;
- "Analyses not run".

**Acceptance:**
- role detection is right on ≥ 95% of columns across the real datasets and the 30 generated businesses (hand-labelled answer file);
- margin facts pass V2;
- the margin PVM identity holds on ≥ 20 random cases;
- golden margin, KPI and Pareto items reach the M14 baseline + 15 pp or ≥ 85%, whichever is higher.

### M16 Working capital and cash
**Scope:**
- AR/AP aging, DSO/DPO;
- the cash pack (flows, burn, runway as run-rate, balance reconciliation);
- inventory turnover, DSI, dead stock and stock-outs;
- the `collect_overdue` and `clear_dead_stock` scenarios.

**Acceptance:**
- each template has a hand-computed test;
- Montgomery County's sales (inventory flow) and HMRC's payments (payables concentration) pass their real-data checks;
- aging is proven on hand-built fixtures and generated businesses (no clean real AR data exists, §4.1a);
- the planted AR-slowdown and dead-stock events reach recall ≥ 80% in the held-out synthetic set.

### M17 Customers
**Scope:**
- cohorts and retention, repeat rate, GRR/NRR, RFM;
- LTV from observed cohorts;
- CAC and payback when spend data exists;
- the `win_back_cohort` scenario.

**Acceptance:**
- cohort-triangle cells are hand-computed on a fixture;
- the worse-retaining-cohort event reaches recall ≥ 80%;
- golden cohort items reach ≥ 85%, including Online Retail II's real customer cohorts.

### M18 Diagnostic depth
**Scope:**
- driver trees (LMDI) and `shapley.v1`;
- two-dimension drill;
- seasonal expectation bands;
- `diff.v1` wired in;
- Simpson surfaced;
- the `ratio_shift` counts and the missing V2 rule;
- reconciliation and the raised quality items;
- quality-weighted confidence.

**Acceptance:**
- the LMDI and Shapley identities hold on random cases;
- Simpson and seasonal-expectation planted events reach ≥ 80% recall;
- the distractor false-positive rate stays ≤ 10% on the held-out set;
- consistency on the top driver reaches ≥ 95%.

### M19 Predictive and prescriptive
Starts only after the maintainer approves the spec change in 2.4.

**Scope:**
- run-rate;
- seasonal naive and ETS forecasts with backtested intervals, plus V9;
- `sensitivity.v1` (elasticity grid, break-even);
- multi-lever scenarios on disjoint revenue;
- `aa check`.

**Acceptance:**
- forecast refits match within 1e-9 under V2;
- interval coverage over the backtests is within ±5 pp of nominal across the real datasets (80% intervals cover 75–85% of held-out points);
- no forecast is shown when MASE ≥ 1;
- `aa check` is demonstrated on a dataset split at a date.

### M20 Market context
**Scope:**
- the `research_competitors` templated tool;
- money and count benchmark parsing;
- source dating;
- the "Market context" section.

**Acceptance:**
- the injection suite (23 fixtures) still passes 100%, with new fixtures in competitor pages;
- the sanitizer test shows no private term leaving the machine across all datasets;
- every market number is an `external_quote` fact that V2 re-parses;
- an offline fixture run is shown in CI.

### M21 Release accuracy run
**Scope:** the full program in §4 on at least three free model families and the local floor model; DABstep through `aa ask` (§4.1b); published results; docs-site pages for each pack.

**Acceptance:** the bars in §4.7. Bars that are not met are published as they are, with the gap and the plan to close it. Launch waits on the maintainer's decision.

## 6. Risks and open questions for the maintainer

1. **Forecasts** (2.4) reverse a written rule. Proposed: intervals only, backtest-gated. **Your decision.**
2. **Role confirmation adds a step.** With `--yes` the roles are kept as assumptions, as metrics are today. Is one combined confirm screen (metrics and roles) acceptable?
3. **The human reviewer** for the golden set and the 20-report grading: you, or an outside analyst?
4. **The ablation's fairness** will be questioned. Proposed: publish the arm A/B prompts and harness, so anyone can rerun them.
5. **Free-tier quota.** The release run (3 families × 5 repeats × all suites) is far beyond Groq's daily quota. The Kaggle vLLM notebook (#27) and OpenRouter/Cerebras free tiers would carry most of it, spread over days. The real-model runs are not CI-bound.
6. **Scope.** M15–M17 are the core of "analyst-grade" for a small business. M18–M20 could follow v0.2 if launch should come sooner.
