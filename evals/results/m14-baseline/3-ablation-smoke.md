# Ablation: smoke, baseline (2026-10-22)

**Harness check, not an engine-vs-model comparison.** Arms A and B gave canned FakeModel answers built from the answer keys, and arm C ran the scripted planner; the numbers show the harness works, not what a model does.

Jobs: coffee_roaster-v1, restaurant-v3, saas-v2. Context window for arm A: 32768 tokens.

| Measure | A (model alone) | B (model + SQL) | C (the engine) |
|---|---|---|---|
| Planted recall@5 (with driver) | 40% (2/5) | 60% (3/5) | 100% (5/5) |
| Driver accuracy | 0% (0/3) | 100% (3/3) | 100% (3/3) |
| Distractor FP rate | 60% (3/5) | 0% (0/5) | 0% (0/5) |
| Tokens in / out | 30 / 15 | 60 / 30 | 1570 / 785 |
| Time (s) | 0.1 | 0.4 | 14.5 |

**Arm A saw a sample.** coffee_roaster-v1: The input is cut to fit the model's context window: t_t1 (sales.xlsx#Orders) shows rows 1–843 of 11564. Answers about the whole data rest on this sample. restaurant-v3: The input is cut to fit the model's context window: t_t1 (sales.xlsx#Orders) shows rows 1–907 of 31389. Answers about the whole data rest on this sample. saas-v2: The input is cut to fit the model's context window: t_t1 (orders.csv) shows rows 1–896 of 14628. Answers about the whole data rest on this sample.

| Paired difference | Tasks | Mean | 95% interval | Adds accuracy? |
|---|---|---|---|---|
| C − A | 5 | 0.600 | [0.200, 1.000] | interval above 0, but canned answers: no claim |
| C − B | 5 | 0.400 | [0.000, 0.800] | not shown (interval includes 0 or is below) |
| B − A | 5 | 0.200 | [-0.600, 1.000] | not shown (interval includes 0 or is below) |

Bootstrap: 10,000 paired resamples, fixed seed (accuracy.md §5).

## Per task

| Arm | Job | Task | Score | Got |
|---|---|---|---|---|
| C | coffee_roaster-v1 | P1 | 1 | found at rank 1 |
| A | coffee_roaster-v1 | P1 | 0 | found at rank 1, wrong driver |
| B | coffee_roaster-v1 | P1 | 1 | found at rank 1 |
| C | restaurant-v3 | P1 | 1 | found at rank 1 |
| C | restaurant-v3 | P3 | 1 | found at rank 2 |
| A | restaurant-v3 | P1 | 0 | found at rank 1, wrong driver |
| A | restaurant-v3 | P3 | 1 | found at rank 2 |
| B | restaurant-v3 | P1 | 1 | found at rank 1 |
| B | restaurant-v3 | P3 | 0 | not found |
| C | saas-v2 | P1 | 1 | found at rank 1 |
| C | saas-v2 | P2 | 1 | found at rank 2 |
| A | saas-v2 | P1 | 0 | found at rank 1, wrong driver |
| A | saas-v2 | P2 | 1 | found at rank 2 |
| B | saas-v2 | P1 | 1 | found at rank 1 |
| B | saas-v2 | P2 | 0 | not found |
