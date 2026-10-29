# A1: role detection against the hand labels

Measured 2026-10-29 by `bun run eval:real:fetch && bun run eval:roles` (`aa eval --suite roles`, the detector's proposal before any confirmation, no model). Engine: `packages/` and `apps/` identical to main `4d5a5c1` (the run's `engine_commit` `a9d9da4` is this branch, which changes only eval tooling and results). Machine-readable: `3-roles.json`. Labels are agent-reviewed, not maintainer-reviewed (evals/roles/README.md).

| Rate | Correct / columns | Rate | Bar | Met |
|---|---|---|---|---|
| **Pooled per column: real + the 30 generated (the A1 figure)** | **424 / 424** | **100.0%** | ≥ 95% | **yes** |
| Real datasets alone | 64 / 64 | 100.0% | ≥ 95% (below it is a known gap) | yes |
| The 30 generated businesses | 360 / 360 | 100.0% | — | — |
| Distinct (layout, column) pairs | 88 / 88 | 100.0% | — | — |
| Synthetic, outside the pool: wholesale-margin-v1 | 12 / 12 | 100.0% | — | — |
| Table kinds (information, no bar) | 65 / 65 tables | 100.0% | — | — |

Per real dataset: Online Retail II 8/8, NZ card spend 14/14, hotel bookings 33/33, Montgomery County 9/9. No dataset was skipped and no column missed.

**The pool.** The harness used to pool the synthetic margin dataset into the A1 figure (436/436 on 2026-10-23, `evals/results/roles/2026-10-23-roles.json`). accuracy.md §11 and the plan's Decision 4 keep it outside the pool, so this branch fixed the harness to match (one line in `summarizeRoles`): the acceptance figure is 424/424, and the 12 synthetic columns are reported as their own group. With them pooled it would read 436/436 (100.0%). coffee-roaster-v1 has no role labels, so it is in neither figure. The distinct-pair count (88) still includes the margin dataset's 12 columns: real 64, the two generated layouts 12, synthetic 12.

**Caveat: the rules were fitted to these labels.** The labels were written before the detector existed (PR 3), but the detector's name lists, value patterns and identities were then built and tuned while reading the labelled columns (PR 4 onward), so 100% here is a fitted score, not a held-out one. The nearest thing to a held-out result is the two datasets added late, scored before the year+month fix: Montgomery County 7/9 and the margin dataset 12/12 (docs/progress/STATE.md, [M15 PR 4]). Unseen layouts will score lower; the release run (M21) needs new, unlabelled-at-build-time data to say how much.
