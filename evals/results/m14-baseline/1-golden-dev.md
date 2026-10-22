# Golden v1: baseline · dev split · 2026-10-22

Items are agent-reviewed, not maintainer-reviewed. An item counts toward the bars only when its independent re-derivation agreed. The baseline is the scripted heuristic with no language model: it answers no follow-up question, so every `ask` item (traps included) is a miss, never n/a.

## hotel-bookings

Job completed in 25.6 s · 2/8 items pass · counted toward the bars: 2/7 numeric and categorical, 0/1 traps; 0 not counted.

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

## nz-card-spend

Job completed in 5.3 s · 3/7 items pass · counted toward the bars: 3/6 numeric and categorical, 0/1 traps; 0 not counted.

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

Job completed in 11.8 s · 2/8 items pass · counted toward the bars: 2/7 numeric and categorical, 0/1 traps; 0 not counted.

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
