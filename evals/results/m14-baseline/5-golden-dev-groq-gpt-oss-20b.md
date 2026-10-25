# Golden v1: openai-compatible:groq:openai/gpt-oss-20b · dev split · 2026-10-23

Items are agent-reviewed, not maintainer-reviewed. An item counts toward the bars only when its independent re-derivation agreed.

## hotel-bookings

Job failed: EXPLAIN failed: Tool call validation failed: tool call validation failed: parameters for tool search_documents did not match schema: errors: [`/from`: '' does not match pattern '^\\d{4}-\\d{2}-\\d{2}$', `/to`: '' does not match pattern '^\\d{4}-\\d{2}-\\d{2}$'] in 236.4 s · 0/8 items pass · counted toward the bars: 0/7 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | **no** | 1809324.75 | no report | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, both hotels together (EUR)? |
| G2 | numeric | fact | **no** | 1970181.6 | no report | What was room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2017, the last month in the data, both hotels together (EUR)? |
| G3 | numeric | ask | **no** | 41.73 | no report | What share of the city hotel's bookings, in percent, were cancelled (all arrival dates)? |
| G4 | categorical | ask | **no** | Non Refund | no report | Which deposit type has the highest cancellation rate, both hotels and all arrival dates together? |
| G5 | numeric | ask | **no** | 118669.91 | no report | By how much did room revenue (ADR × nights, bookings not cancelled), both hotels together, change from April 2017 to May 2017 arrivals (May minus April, EUR)? |
| G6 | numeric | ask | **no** | 81.98 | no report | What share of all bookings, in percent, came through the travel agent and tour operator channel (TA/TO), cancelled bookings included? |
| G7 | categorical | ask | **no** | Resort Hotel | no report | Which hotel had more room revenue (ADR × nights, bookings not cancelled) for arrivals in August 2016, the resort hotel or the city hotel? |
| G8 | trap | ask | **no** | refusal | no report | What was the gross operating profit margin of the two hotels in 2016? |

## nz-card-spend

Job failed: EXPLAIN failed: Tool call validation failed: tool call validation failed: parameters for tool search_documents did not match schema: errors: [`/from`: '2020-03' does not match pattern '^\\d{4}-\\d{2}-\\d{2}$', `/to`: '2020-04' does not match pattern '^\\d{4}-\\d{2}-\\d{2}$'] in 66.5 s · 0/7 items pass · counted toward the bars: 0/6 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | **no** | 11321.6 | no report | What was total card spending, all industry groups together, in December 2025 (NZD million)? |
| G2 | numeric | fact | **no** | 9190.7 | no report | What was total card spending, all industry groups together, in September 2026, the latest month (NZD million)? |
| G3 | categorical | driver | **no** | Durables | no report | Which industry group contributed the largest decrease in NZD to the fall in card spending from March to April 2020? |
| G4 | numeric | ask | **no** | -3803.7 | no report | By how much did total card spending, all industry groups together, change from March 2020 to April 2020 (NZD million)? |
| G5 | numeric | ask | **no** | 29.015 | no report | What share of 2025 card spending, in percent, was in the Consumables industry group? |
| G6 | numeric | ask | **no** | 1.25 | no report | By what percentage was total card spending, all industry groups together, in September 2026 above September 2025, the same month a year earlier? |
| G7 | trap | ask | **no** | refusal | no report | What was the average value of a card transaction in 2025? |

## online-retail-ii

Job failed: EXPLAIN failed: Request too large for model `openai/gpt-oss-20b` in organization `org_***` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 39207, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing in 66.4 s · 0/8 items pass · counted toward the bars: 0/7 numeric and categorical, 0/1 traps; 0 not counted.

| Item | Kind | Source | Pass | Expected | Got | Question |
|---|---|---|---|---|---|---|
| G1 | numeric | fact | **no** | 140447.11 | no report | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in November 2010? |
| G2 | numeric | fact | **no** | 201 | no report | How many distinct invoices (cancellation invoices included) were there in December 2010? |
| G3 | numeric | ask | **no** | 145480.93 | no report | What were net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) in the best-selling month of 2011? |
| G4 | numeric | ask | **no** | 37570.84 | no report | By how much did net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) change from October 2011 to November 2011? |
| G5 | numeric | ask | **no** | 13.7 | no report | What share of 2010 net sales, in percent, came from the ten customers with the highest 2010 net sales? Lines with no customer ID stay in the total. |
| G6 | numeric | ask | **no** | 3.58 | no report | By what percentage were November 2011 net sales (quantity × price over all lines, cancellations, postage, fees and manual adjustments included) above November 2010, the same month a year earlier? |
| G7 | categorical | driver | **no** | United Kingdom | no report | Which country accounted for most of the fall in invoices from November to December 2010? |
| G8 | trap | ask | **no** | refusal | no report | What was the gross margin on 2011 sales? |
