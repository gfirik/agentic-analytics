# M15 baseline: the M14 engine on the M15 golden item set

Measured 2026-10-23 by `bun run eval:real:fetch && bun run eval -- --suite golden --model baseline` (the scripted heuristic, no language model, dev split, counted items only). The engine is the M14 engine: `packages/` and `apps/` at engine commit `735dbe5` are identical to main `53860c7` (this branch only adds eval tooling under `evals/` and docs). The bar for each M15 capability is `max(baseline rate + 15 pp, 85%)` (docs/plans/m15.md A4); the scripted baseline answers no follow-up question, so every `ask` item is a miss. The real-model figure is DEFERRED to the nightly slot. Items are agent-reviewed, not maintainer-reviewed. Machine-readable: `0-baseline-m14-engine.json`.

| Capability | Passed / counted | Baseline rate | Bar |
|---|---|---|---|
| kpi | 6 / 15 | 40.0% | 85% |
| margin | 0 / 3 | 0.0% | 85% |
| pareto | 0 / 4 | 0.0% | 85% |

Granularity: with 3 margin items one pass moves the rate 33 points, and with 4 Pareto items 25 points; the margin dataset's 4 items and Montgomery County's items join in the follow-up commit once M15 PR 2 merges.

## Golden v1: baseline · dev split · 2026-10-23

Engine commit: 735dbe583c5cbf19729c9836d70e06ec8ab86c61.

Items are agent-reviewed, not maintainer-reviewed. An item counts toward the bars only when its independent re-derivation agreed. The baseline is the scripted heuristic with no language model: it answers no follow-up question, so every `ask` item (traps included) is a miss, never n/a.

## Capabilities

```
capability   passed/counted   rate     M14 baseline          bar (max(baseline + 15 pp, 85%))
kpi          6/15             40.0%    n/a                   n/a
margin       0/3              0.0%     n/a                   n/a
pareto       0/4              0.0%     n/a                   n/a
```

## hotel-bookings

Job completed in 27.4 s · 2/9 items pass · counted toward the bars: 2/8 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 1809324.75 | 1809324.7500000042 | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, both hotels together (EUR)? |
| G2 | numeric | fact | yes | 1970181.6 | 1970181.6000000036 | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2017, the last month in the data, both hotels together (EUR)? |
| G3 | numeric | ask | **no** | 41.73 | no answer (FakeModel has no scripted response for role=planner promptHash=24a1546f: Answer the question.) | What share of the city hotel's bookings, in percent, were cancelled (all arrival dates)? |
| G4 | categorical | ask | **no** | Non Refund | no answer (FakeModel has no scripted response for role=planner promptHash=0307b5ac: Answer the question.) | Which deposit type has the highest cancellation rate, both hotels and all arrival dates together? |
| G5 | numeric | ask | **no** | 118669.91 | no answer (FakeModel has no scripted response for role=planner promptHash=4df2b94d: Answer the question.) | By how much did room revenue (ADR × nights, bookings not cancelled), both hotels together, change from April 2017 to May 2017 arrivals (May minus April, EUR)? |
| G6 | numeric | ask | **no** | 81.98 | no answer (FakeModel has no scripted response for role=planner promptHash=d5bd2436: Answer the question.) | What share of all bookings, in percent, came through the travel agent and tour operator channel (TA/TO), cancelled bookings included? |
| G7 | categorical | ask | **no** | Resort Hotel | no answer (FakeModel has no scripted response for role=planner promptHash=39ada550: Answer the question.) | Which hotel had more room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, the resort hotel or the city hotel? |
| G8 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=b1d0731f: Answer the question.) | What was the gross operating profit margin of the two hotels in 2016? |
| G12 | numeric | fact | **no** | 0.8273 | no fact scorecard.cancellation_rate.yoy_2017-08 | By how many percentage points did the cancellation rate (the share of bookings cancelled, by arrival month, both hotels together) change from August 2016 to August 2017, the last month in the data? |

## nz-card-spend

Job completed in 6.1 s · 3/7 items pass · counted toward the bars: 3/6 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 11321.6 | 11321.6 | What was total card spending, all industry groups together, in December 2025 (NZD million)? |
| G2 | numeric | fact | yes | 9190.7 | 9190.7 | What was total card spending, all industry groups together, in September 2026, the latest month (NZD million)? |
| G3 | categorical | driver | yes | Durables | Durables | Which industry group contributed the largest decrease in NZD to the fall in card spending from March to April 2020? |
| G4 | numeric | ask | **no** | -3803.7 | no answer (FakeModel has no scripted response for role=planner promptHash=86b3b549: Answer the question.) | By how much did total card spending, all industry groups together, change from March 2020 to April 2020 (NZD million)? |
| G5 | numeric | ask | **no** | 29.015 | no answer (FakeModel has no scripted response for role=planner promptHash=acc46eaf: Answer the question.) | What share of 2025 card spending, in percent, was in the Consumables industry group? |
| G6 | numeric | ask | **no** | 1.25 | no answer (FakeModel has no scripted response for role=planner promptHash=e17aab3b: Answer the question.) | By what percentage was total card spending, all industry groups together, in September 2026 above September 2025, the same month a year earlier? |
| G7 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=0020d93a: Answer the question.) | What was the average value of a card transaction in 2025? |

## online-retail-ii

Job completed in 13.4 s · 2/11 items pass · counted toward the bars: 2/9 numeric and categorical, 0/2 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 140447.11 | 140447.10999999937 | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in November 2010? |
| G2 | numeric | fact | yes | 201 | 201 | How many distinct invoices (cancellation invoices included) were there in December 2010? |
| G3 | numeric | ask | **no** | 145480.93 | no answer (FakeModel has no scripted response for role=planner promptHash=8881ba09: Answer the question.) | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in the best-selling month of 2011? |
| G4 | numeric | ask | **no** | 37570.84 | no answer (FakeModel has no scripted response for role=planner promptHash=c3216eac: Answer the question.) | By how much did net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) change from October 2011 to November 2011? |
| G5 | numeric | ask | **no** | 13.7 | no answer (FakeModel has no scripted response for role=planner promptHash=3d621d90: Answer the question.) | What share of 2010 net sales, in percent, came from the ten customers with the highest 2010 net sales? Lines with no customer ID stay in the total. |
| G6 | numeric | ask | **no** | 3.58 | no answer (FakeModel has no scripted response for role=planner promptHash=024601a7: Answer the question.) | By what percentage were November 2011 net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) above November 2010, the same month a year earlier? |
| G7 | categorical | driver | **no** | United Kingdom | no driver | Which country accounted for most of the fall in invoices from November to December 2010? |
| G8 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=9a70101b: Answer the question.) | What was the gross margin on 2011 sales? |
| G12 | numeric | fact | **no** | 383.74 | no fact aov_2010-11 | What was the average order value in November 2010: net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) divided by the number of distinct invoices (cancellation invoices included)? |
| G13 | numeric | fact | **no** | 432 | no fact pareto.a_count.customer_ttm | Rank customers by their net sales (quantity × price, cancellations netted in) over the 12 months from January to December 2011 and keep only customers with positive net sales. How many customers does class A hold, where class A is the customers whose cumulative share of the total, counted from the largest down, is at most 80%? |
| G14 | trap | not_run | **no** | refusal | no "Analyses not run" entry for gross_margin | What was the gross margin (net sales minus the cost of the goods sold) in November 2010? |
