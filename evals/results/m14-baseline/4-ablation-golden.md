# Ablation: golden, baseline (2026-10-22)

**Harness check, not an engine-vs-model comparison.** Arms A and B gave canned FakeModel answers built from the answer keys, and arm C ran the scripted planner; the numbers show the harness works, not what a model does.

Jobs: hotel-bookings, nz-card-spend, online-retail-ii. Context window for arm A: 32768 tokens.

| Measure | A (model alone) | B (model + SQL) | C (the engine) |
|---|---|---|---|
| Numeric accuracy | 50% (8/16) | 0% (0/16) | 38% (6/16) |
| Categorical accuracy | 100% (4/4) | 0% (0/4) | 25% (1/4) |
| Trap pass rate | 0% (0/3) | 100% (3/3) | 0% (0/3) |
| Unsupported-number rate | 47% (9/19) | n/a (0 of 0) | — |
| … without source cells | 53% (10/19) | n/a (0 of 0) | — |
| Citation validity (SQL re-run) | — | n/a (0 of 0) | — |
| Tokens in / out | 230 / 115 | 460 / 230 | 380 / 190 |
| Time (s) | 7.7 | 1.6 | 42.6 |

**Arm A saw a sample.** hotel-bookings: The input is cut to fit the model's context window: t_t1 (hotel-bookings.csv) shows rows 1–394 of 119390. Answers about the whole data rest on this sample. nz-card-spend: The input is cut to fit the model's context window: t_t1 (nz-card-spend-by-industry.csv) shows rows 1–476 of 2568. Answers about the whole data rest on this sample. online-retail-ii: The input is cut to fit the model's context window: t_t1 (online_retail_II.sample10.csv) shows rows 1–603 of 105797. Answers about the whole data rest on this sample.

The unsupported-number support set is the golden answers, arm C's facts for the same job and the source cells of the columns each item names; the second row leaves the cells out. It is wider than "the data or the golden set", which favours arms A and B.

| Paired difference | Tasks | Mean | 95% interval | Adds accuracy? |
|---|---|---|---|---|
| C − A | 23 | -0.217 | [-0.478, 0.043] | not shown (interval includes 0 or is below) |
| C − B | 23 | 0.174 | [-0.087, 0.435] | not shown (interval includes 0 or is below) |
| B − A | 23 | -0.391 | [-0.652, -0.087] | not shown (interval includes 0 or is below) |

Bootstrap: 10,000 paired resamples, fixed seed (accuracy.md §5).

## Per task

| Arm | Job | Task | Score | Got |
|---|---|---|---|---|
| C | hotel-bookings | G1 | 1 | 1809324.7500000042 |
| C | hotel-bookings | G2 | 1 | 1970181.6000000036 |
| C | hotel-bookings | G3 | 0 | no answer |
| C | hotel-bookings | G4 | 0 | no answer |
| C | hotel-bookings | G5 | 0 | no answer |
| C | hotel-bookings | G6 | 0 | no answer |
| C | hotel-bookings | G7 | 0 | no answer |
| C | hotel-bookings | G8 | 0 | no answer |
| A | hotel-bookings | G1 | 1 | 1,809,324.75 |
| A | hotel-bookings | G2 | 0 | 2,167,200 |
| A | hotel-bookings | G3 | 1 | 41.73 |
| A | hotel-bookings | G4 | 1 | Non Refund |
| A | hotel-bookings | G5 | 1 | 118,669.91 |
| A | hotel-bookings | G6 | 0 | 90 |
| A | hotel-bookings | G7 | 1 | Resort Hotel |
| A | hotel-bookings | G8 | 0 | answered: It will be about 512,000. |
| B | hotel-bookings | G1 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G2 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G3 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G4 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G5 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G6 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G7 | 0 | refused: SQL_REFUSED |
| B | hotel-bookings | G8 | 1 | refused: no column answers it (SQL_REFUSED) |
| C | nz-card-spend | G1 | 1 | 11321.6 |
| C | nz-card-spend | G2 | 1 | 9190.7 |
| C | nz-card-spend | G3 | 1 | Durables |
| C | nz-card-spend | G4 | 0 | no answer |
| C | nz-card-spend | G5 | 0 | no answer |
| C | nz-card-spend | G6 | 0 | no answer |
| C | nz-card-spend | G7 | 0 | no answer |
| A | nz-card-spend | G1 | 1 | 11,321.6 |
| A | nz-card-spend | G2 | 0 | 10,110 |
| A | nz-card-spend | G3 | 1 | Durables |
| A | nz-card-spend | G4 | 0 | -4,184 |
| A | nz-card-spend | G5 | 1 | 29.02 |
| A | nz-card-spend | G6 | 0 | 1 |
| A | nz-card-spend | G7 | 0 | answered: It will be about 512,000. |
| B | nz-card-spend | G1 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G2 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G3 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G4 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G5 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G6 | 0 | refused: SQL_REFUSED |
| B | nz-card-spend | G7 | 1 | refused: no column answers it (SQL_REFUSED) |
| C | online-retail-ii | G1 | 1 | 140447.10999999937 |
| C | online-retail-ii | G2 | 1 | 201 |
| C | online-retail-ii | G3 | 0 | no answer |
| C | online-retail-ii | G4 | 0 | no answer |
| C | online-retail-ii | G5 | 0 | no answer |
| C | online-retail-ii | G6 | 0 | no answer |
| C | online-retail-ii | G7 | 0 | no driver |
| C | online-retail-ii | G8 | 0 | no answer |
| A | online-retail-ii | G1 | 1 | 140,447.11 |
| A | online-retail-ii | G2 | 0 | 221 |
| A | online-retail-ii | G3 | 1 | 145,480.93 |
| A | online-retail-ii | G4 | 0 | 41,328 |
| A | online-retail-ii | G5 | 1 | 13.7 |
| A | online-retail-ii | G6 | 0 | 4 |
| A | online-retail-ii | G7 | 1 | United Kingdom |
| A | online-retail-ii | G8 | 0 | answered: It will be about 512,000. |
| B | online-retail-ii | G1 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G2 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G3 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G4 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G5 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G6 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G7 | 0 | refused: SQL_REFUSED |
| B | online-retail-ii | G8 | 1 | refused: no column answers it (SQL_REFUSED) |
