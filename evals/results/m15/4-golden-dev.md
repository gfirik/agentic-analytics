# Golden v1: baseline · dev split · 2026-10-29

Engine commit: a9d9da47cc637aba70cc63643fcea98664f8982d.

Items are agent-reviewed, not maintainer-reviewed. An item counts toward the bars only when its independent re-derivation agreed. The baseline is the scripted heuristic with no language model: it answers no follow-up question, so every `ask` item (traps included) is a miss, never n/a.

## Capabilities

```
capability   passed/counted   rate     M14 baseline          bar (max(baseline + 15 pp, 85%))
kpi          8/15             53.3%    6/15 = 40.0%          85.0%
margin       5/7              71.4%    0/7 = 0.0%            85.0%
pareto       2/6              33.3%    0/6 = 0.0%            85.0%
```

## hotel-bookings

Job completed in 48.2 s · 3/9 items pass · counted toward the bars: 3/8 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 1809324.75 | 1809324.7500000042 | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, both hotels together (EUR)? |
| G2 | numeric | fact | yes | 1970181.6 | 1970181.6000000036 | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2017, the last month in the data, both hotels together (EUR)? |
| G3 | numeric | ask | **no** | 41.73 | no answer (FakeModel has no scripted response for role=planner promptHash=0b4bb359: Answer the question.) | What share of the city hotel's bookings, in percent, were cancelled (all arrival dates)? |
| G4 | categorical | ask | **no** | Non Refund | no answer (FakeModel has no scripted response for role=planner promptHash=17d03688: Answer the question.) | Which deposit type has the highest cancellation rate, both hotels and all arrival dates together? |
| G5 | numeric | ask | **no** | 118669.91 | no answer (FakeModel has no scripted response for role=planner promptHash=daad520f: Answer the question.) | By how much did room revenue (ADR × nights, bookings not cancelled), both hotels together, change from April 2017 to May 2017 arrivals (May minus April, EUR)? |
| G6 | numeric | ask | **no** | 81.98 | no answer (FakeModel has no scripted response for role=planner promptHash=cfdeccf2: Answer the question.) | What share of all bookings, in percent, came through the travel agent and tour operator channel (TA/TO), cancelled bookings included? |
| G7 | categorical | ask | **no** | Resort Hotel | no answer (FakeModel has no scripted response for role=planner promptHash=ecc7e2e4: Answer the question.) | Which hotel had more room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, the resort hotel or the city hotel? |
| G8 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=9c46bce9: Answer the question.) | What was the gross operating profit margin of the two hotels in 2016? |
| G12 | numeric | fact | yes | 0.8273 | 0.8272738118990048 | By how many percentage points did the cancellation rate (the share of bookings cancelled, by arrival month, both hotels together) change from August 2016 to August 2017, the last month in the data? |

## montgomery-warehouse-sales

Job completed in 143.8 s · 3/3 items pass · counted toward the bars: 2/2 numeric and categorical, 1/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 29.923 | 29.922972809811704 | What share of 2019 retail sales (rtl_sales, January to November, the months the file has), in percent, came from the five suppliers with the most retail sales that year? Lines with no supplier are left out of the total, and so are suppliers whose 2019 retail sales are not positive. |
| G2 | numeric | fact | yes | 0.031832 | 0.03183241326846333 | What was the Herfindahl-Hirschman index (the sum of squared shares) of the suppliers' 2019 retail sales (rtl_sales), as a fraction between 0 and 1? Lines with no supplier are left out of the total, and so are suppliers whose 2019 retail sales are not positive. |
| G3 | trap | not_run | yes | refusal | not run: There is no cost column (unit cost or cost amount), so margin can't be computed. | What was the gross margin on Montgomery County's retail sales in 2019? |

## nz-card-spend

Job completed in 5.6 s · 3/7 items pass · counted toward the bars: 3/6 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 11321.6 | 11321.6 | What was total card spending, all industry groups together, in December 2025 (NZD million)? |
| G2 | numeric | fact | yes | 9190.7 | 9190.7 | What was total card spending, all industry groups together, in September 2026, the latest month (NZD million)? |
| G3 | categorical | driver | yes | Durables | Durables | Which industry group contributed the largest decrease in NZD to the fall in card spending from March to April 2020? |
| G4 | numeric | ask | **no** | -3803.7 | no answer (FakeModel has no scripted response for role=planner promptHash=2af27482: Answer the question.) | By how much did total card spending, all industry groups together, change from March 2020 to April 2020 (NZD million)? |
| G5 | numeric | ask | **no** | 29.015 | no answer (FakeModel has no scripted response for role=planner promptHash=cc051e9c: Answer the question.) | What share of 2025 card spending, in percent, was in the Consumables industry group? |
| G6 | numeric | ask | **no** | 1.25 | no answer (FakeModel has no scripted response for role=planner promptHash=095d7740: Answer the question.) | By what percentage was total card spending, all industry groups together, in September 2026 above September 2025, the same month a year earlier? |
| G7 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=3e1fa29b: Answer the question.) | What was the average value of a card transaction in 2025? |

## online-retail-ii

Job completed in 36.5 s · 4/11 items pass · counted toward the bars: 3/9 numeric and categorical, 1/2 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 140447.11 | 140447.10999999937 | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in November 2010? |
| G2 | numeric | fact | yes | 201 | 201 | How many distinct invoices (cancellation invoices included) were there in December 2010? |
| G3 | numeric | ask | **no** | 145480.93 | no answer (FakeModel has no scripted response for role=planner promptHash=69b47fc8: Answer the question.) | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in the best-selling month of 2011? |
| G4 | numeric | ask | **no** | 37570.84 | no answer (FakeModel has no scripted response for role=planner promptHash=8d8722ad: Answer the question.) | By how much did net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) change from October 2011 to November 2011? |
| G5 | numeric | ask | **no** | 13.7 | no answer (FakeModel has no scripted response for role=planner promptHash=02359b69: Answer the question.) | What share of 2010 net sales, in percent, came from the ten customers with the highest 2010 net sales? Lines with no customer ID stay in the total. |
| G6 | numeric | ask | **no** | 3.58 | no answer (FakeModel has no scripted response for role=planner promptHash=82d1ea56: Answer the question.) | By what percentage were November 2011 net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) above November 2010, the same month a year earlier? |
| G7 | categorical | driver | **no** | United Kingdom | no driver | Which country accounted for most of the fall in invoices from November to December 2010? |
| G8 | trap | ask | **no** | refusal | no answer (FakeModel has no scripted response for role=planner promptHash=c8c2bd02: Answer the question.) | What was the gross margin on 2011 sales? |
| G12 | numeric | fact | yes | 383.74 | 383.73527322404203 | What was the average order value in November 2010: net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) divided by the number of distinct invoices (cancellation invoices included)? |
| G13 | numeric | fact | **no** | 432 | 449 | Rank customers by their net sales (quantity × price, cancellations netted in) over the 12 months from January to December 2011 and keep only customers with positive net sales. How many customers does class A hold, where class A is the customers whose cumulative share of the total, counted from the largest down, is at most 80%? |
| G14 | trap | not_run | yes | refusal | not run: There is no cost column (unit cost or cost amount), so margin can't be computed. | What was the gross margin (net sales minus the cost of the goods sold) in November 2010? |

## wholesale-margin-v1

Job completed in 8.4 s · 3/3 items pass · counted toward the bars: 3/3 numeric and categorical, 0/0 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | yes | 14172.4 | 14172.400000000001 | What was gross margin (net sales minus quantity × standard cost over all lines) in March 2026, in GBP? |
| G2 | numeric | fact | yes | 25.1904 | 25.190425349952285 | What was the gross margin percentage (gross margin divided by net sales) in June 2026, the latest month, in percent? |
| G3 | numeric | fact | yes | -1902 | -1902 | Of the change in gross margin from February to March 2026, how much came from unit costs rising (the cost effect: minus the sum over products of March units × (March standard cost − February standard cost)), in GBP? |
