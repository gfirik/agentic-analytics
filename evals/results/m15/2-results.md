# Results against the bars (M15 PR 11)

The M15 engine on its acceptance bars (docs/plans/m15.md A1–A4), measured 2026-10-29 on this machine, offline, with no language model. Each run went through `scripts/heavy.sh`, one at a time. The engine is main `4d5a5c1`, after #117–#121. `packages/` and `apps/` are identical to it at the runs' `engine_commit` `a9d9da4`, because this branch changes only eval tooling and results. Labels and golden items are agent-reviewed, not maintainer-reviewed. Counts are shown beside every rate, and nothing is rounded up.

| Bar | Acceptance | Offline result | Met offline |
|---|---|---|---|
| A1 | Role detection right on ≥ 95% of columns, real datasets plus the 30 generated | **424/424 = 100.0%** (real alone 64/64; fitted, see below) | yes |
| A2 | Margin facts pass V2 | 0 V2 mismatches: unit fixtures, the margin job (486 numbers), the 30 and the real tier | yes |
| A3 | The margin PVM identity holds on ≥ 20 random cases | 200 seeded cases + 50 zero-base cases + 3 hand-computed cases hold | yes |
| A4 | Golden kpi, margin and Pareto items reach max(M14 baseline + 15 pp, 85%) | kpi 8/15 = 53.3%, margin 5/7 = 71.4%, pareto 2/6 = 33.3% (scripted) | **no**: below the bar on all three (see A4) |
| Regression | The 30 and the real tier keep their bars and 0 number mismatches | full suite 30/30 jobs, 0 mismatches, recall@5 48/50 = 96.0%; real tier 18/20 checks (hotel C4 and C6, as before) | yes |

A1–A3 and the regression set hold offline. A4 is below its bar offline, for the reasons below. Its real-model check is DEFERRED, and the deferred slot is paused because no free model can run the engine (docs/progress/STATE.md "Deferred checks").

## A1: role detection

Command: `bun run eval:real:fetch && bun run eval:roles`. The full page and its caveats are under "A1: role detection against the hand labels" below, and the data is in `3-roles.json`.

| Group | Correct / columns | Rate |
|---|---|---|
| **Pooled: real + the 30 generated (the acceptance figure)** | **424 / 424** | **100.0%** |
| Real datasets alone (Online Retail II 8, NZ card spend 14, hotel bookings 33, Montgomery County 9) | 64 / 64 | 100.0% |
| The 30 generated businesses (two header layouts) | 360 / 360 | 100.0% |
| Distinct (layout, column) pairs | 88 / 88 | 100.0% |
| Outside the pool: wholesale-margin-v1 (synthetic) | 12 / 12 | 100.0% |
| With the synthetic columns pooled (not the acceptance figure) | 436 / 436 | 100.0% |
| Table kinds (information, no bar) | 65 / 65 | 100.0% |

- **The 424 pool.** accuracy.md §11 and Decision 4 keep the committed synthetic datasets out of the pool. The harness used to pool them (436 on 2026-10-23), and this branch fixed that in one line.
- **coffee-roaster-v1** has no role labels, so it is in neither figure.
- **Caveat:** the detector's rules were fitted while reading the labelled columns. The labels came first, but the rules were tuned against them, so 100% is a fitted score. The closest held-out evidence is Montgomery County 7/9, scored before the year+month fix.

## A2: margin facts pass V2

| Check | Command | Result |
|---|---|---|
| (a) Unit: every margin function on the hand-computed fixtures, plus tampering | `bunx vitest run packages/verify/test/margin-v2.test.ts` | 21/21 tests pass. `gross_margin`, `gross_margin_pct` and each `pvm_margin.v1` effect recompute through V2 with 0 mismatches. A value tampered by +0.01 is a mismatch for every margin function. The V4 cost-role checks pass |
| (b) End to end on wholesale-margin-v1 | the job `evals/runner/test/margin-job.test.ts` runs (scripted baseline model, today 2026-07-03, GBP), with report.json kept | 486 numbers checked, **0 V2 mismatches**, 0 definition violations, 0 claims dropped. Margin facts: `gross_margin` 22, `gross_margin_pct` 12, `pvm_margin.v1` 4. `margin-job.test.ts`: 2/2 pass |
| (c) No regression | `bun run eval -- --suite full --model baseline`; `bun run eval:real` | 0 number mismatches on all 30 jobs and all 4 real datasets (C2 passes on each: hotel 564 numbers, Montgomery 375, NZ 386, Online Retail II 491) |

The (b) demo as a user runs it, `bun run aa analyze evals/datasets/wholesale-margin-v1/files --yes --currency GBP --today 2026-07-03`, needs a configured model and stays DEFERRED ([M15 PR 8]). The same job runs here with the scripted model.

## A3: the margin PVM identity

Command: `bunx vitest run packages/analysis/test/pvm-margin.test.ts`. 7/7 tests pass:

- **The identity:** price + volume + mix + cost + new + lost + unpriced = Δmargin within a relative 1e-9 over **200 seeded random cases** (mulberry32, fixed seed; 1–12 items; new, lost, unpriced and uncosted items; returns), and V2 recomputes each effect.
- **Zero base:** it also holds over **50 seeded cases** whose common items' base quantity is exactly 0.
- **Hand-computed cases:** case 1 (ΔM = −8), case 2 (ΔM = −22 over all seven effects) and the zero-base case (3 = 0 + 1 + 2 + 0).
- **Reduction:** with no cost, it reduces to `pvm.v1`.

## A4: golden items per capability (scripted)

Command: `bun run eval:real:fetch && bun run eval -- --suite golden --model baseline`, over counted dev items. The full per-item page is under "Golden v1: baseline · dev split · 2026-10-29" below, and the data is in `4-golden-dev.json`. The M14 baseline is `1-baseline-m14-engine-full`.

| Capability | Passed / counted | Rate | M14 baseline | Bar | Met | Misses | Best a scripted run can score |
|---|---|---|---|---|---|---|---|
| kpi | 8 / 15 | 53.3% | 6 / 15 = 40.0% | 85% | **no** | 7, all `ask` | 8 / 15 = 53.3% |
| margin | 5 / 7 | 71.4% | 0 / 7 = 0.0% | 85% | **no** | 2, both `ask` (the retail G8 and hotel G8 traps) | 5 / 7 = 71.4% |
| pareto | 2 / 6 | 33.3% | 0 / 6 = 0.0% | 85% | **no** | 3 `ask` (hotel G6, NZ G5, retail G5) and retail G13 | 3 / 6 = 50.0% |

**The offline acceptance is below the bar on all three capabilities, and offline it can't reach it.**

- **The `ask` items.** The scripted baseline answers no follow-up question, so every `ask` item is a miss. That is 12 of the 28 counted kpi, margin and Pareto items: 7 of 15 kpi, 2 of 7 margin, 3 of 6 Pareto. Every item read from the report (`fact`, `driver`, `not_run`) passes in kpi and margin. So even a perfect report scores at most 53.3%, 71.4% and 50.0%, all under 85%. Only a model answering the `ask` items can meet the bar, and that run is DEFERRED.
- **Retail G13**, a recorded miss that is not edited. The item expects 432 class-A customers over January to December 2011, which counts the part-month December (the data ends 2011-12-09). The engine's `pareto.a_count.customer_ttm` is 449, from the spec's window (analysis-library §11.1): the 12 months to the report's last complete month, 2010-12 to 2011-11. DuckDB on the raw file gives 449 of 1,219 positive customers for that window. A golden item is not edited after the engine exists. It gets an independent re-derivation at M21 ([M15 PR 11 prep]).
- **Gains over the M14 baseline:** kpi +2 items (aov `aov_2010-11` and the hotel cancellation-rate change, both new facts). Margin +5: the three margin-dataset facts, and the retail G14 and Montgomery G3 traps answered by "Analyses not run". Pareto +2: Montgomery's top-5 share and HHI.
- **Granularity:** with 7 margin items one pass moves the rate 14.3 points, and with 6 Pareto items 16.7 points. 85% needs 13 of 15, 6 of 7 and 6 of 6.
- **The real-model check (DEFERRED):** `golden-m15 | eval -- --suite golden --model MODEL` is queued in `evals/deferred.txt`; the absolute 85% applies. M14's queued `golden-v1` real-model run has not run on an M14 engine, so the scripted baseline stays the M14 baseline of record (Decision 5).

## Regression set

| Run | Command | Result | Before (M15 PR 11 prep, pre-#120) |
|---|---|---|---|
| The 30, offline baseline | `bun run eval -- --suite full --model baseline` | 30/30 jobs, 0 number mismatches, planted recall@5 **48/50 = 96.0%** (misses: distributor-v2 P2, agency-v2 P2), distractors reported 0/50, every bar met. Data: `5-regression-full-baseline.json` | 30/30, 0 mismatches, 96.0%, the same two misses |
| Real tier, offline baseline | `bun run eval:real:fetch && bun run eval:real` | **18/20 checks**: Online Retail II 7/7, NZ card spend 5/5, Montgomery County 2/2, hotel bookings 4/6 (C4: a seasonal October to November fall reported as F5; C6: the 5,400 ADR outlier not reported). Data: `6-regression-real-baseline.json` | 18/20, the same two |

## The margin dataset's planted recall (scored by hand)

wholesale-margin-v1 has no answer key in the 30's format, so its report was scored by hand against the dataset README's planted events. The data is in `7-margin-planted-recall.json`.

| Event | Expected | Report | Result |
|---|---|---|---|
| Margin squeeze at flat revenue, 2026-03 | gross margin 16,414.24 → 14,172.40 (−2,241.84); cost effect −1,902.00, price −325.8516, volume −26.2943, mix 12.3059 | F1 (rank 1), with exactly these values; F2 is the margin % move | **found, rank 1** |
| Price rise outrunning its cost rise, 2026-05 | gross margin +818.20 | not in the 5 findings: F3–F5 are the 2026-05 → 2026-06 changes and a cost trend, because ranking prefers the latest month | **missed** |
| Distractor: coffee units, 2026-04 | not reported | not reported | **correct** |

Planted recall@5 is **1/2 = 50%**, and the distractor is not reported. Information only: there is no bar for this dataset.

## Gaps

- **A4 is below the bar offline** (the `ask` items and G13, above). Its real-model check is DEFERRED, and the deferred slot is paused: no free model the slot can use fits the engine's EXPLAIN requests (about 39,000 tokens against an 8,000 tokens-a-minute free tier).
- **A1 is a fitted score.** No held-out role labels exist yet.
- **Margin is proven on synthetic data only.** No real dataset with a cost column passed the licence check (plan, Risks). The real-data coverage gap for margin carries to M21.
- **The margin dataset's 2026-05 price event** is not in the top 5. The latest-month preference in ranking pushes it out.
- **Hotel C4 and C6** in the real tier, and **retail G7** (no driver on anomaly findings), are unchanged.
- **The roles tie-break is not measured yet.** The `roles-m15` queue line runs `--suite roles --model MODEL`, and today's CLI refuses a model on that suite, so the measurement needs building before that line can run.
