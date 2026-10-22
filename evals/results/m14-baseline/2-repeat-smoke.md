# Consistency: baseline · smoke suite · 5 runs · 2026-10-22

Response cache: n/a (scripted model, no provider calls). Datasets: coffee_roaster-v1, restaurant-v3, saas-v2, tool_hire-v1.

- Run 1: 4/4 jobs finished, 0 provider calls (0 cached)
- Run 2: 4/4 jobs finished, 0 provider calls (0 cached)
- Run 3: 4/4 jobs finished, 0 provider calls (0 cached)
- Run 4: 4/4 jobs finished, 0 provider calls (0 cached)
- Run 5: 4/4 jobs finished, 0 provider calls (0 cached)

| Measure | Jobs where every run agrees | Bar (§4.7, over 5 runs) | Pass |
|---|---|---|---|
| (a) numbers: every fact value identical | 4/4 (100.0%) | 100% | yes |
| (b) findings: the same top-5 findings | 4/4 (100.0%) | 95% | yes |
| (c) driver: the same top driver per finding | 4/4 (100.0%) | 95% | yes |
| (d) cause grade: the same grade per finding | 4/4 (100.0%) | 90% | yes |
| (e) action: the same top recommendation scenario | 4/4 (100.0%) | 90% | yes |

## Disagreements

None: every run agreed on every measure.
