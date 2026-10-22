# Spec: accuracy measurement (M14)

The tools that put the engine's accuracy in numbers (docs/plans/analyst-grade.md §4, docs/plans/m14.md). Each section lands with the code that implements it; sections for `--repeat`, the ablation, the held-out sets and the matrix runner are added by their PRs.

## 1. Golden set: format

A golden set is a YAML file per dataset, `evals/golden/<dataset>/golden.yaml` (dev split) and `heldout.yaml` (held-out split, read only by release runs). Each item (`GoldenItem` in evals/runner/src/golden.ts) has:

- `id` (`G1`, `G2`, …), `question`, `kind`: `numeric`, `categorical` or `trap`;
- for `numeric`, `expected` and `tolerance` (`abs`, `rel`; a value passes within either; 0 means exact); for `categorical`, `expected` (compared case-insensitively); for `trap`, `reason` (why the data can't answer);
- `source`: where the engine's answer is read from (§2);
- `columns`: the columns the question is about (the ablation's support set reads source cells from these only);
- `sql`: the query that computes the expected answer, written apart from the engine. For the reviewed sets (M14 PR 3 onward) it reads the raw source files (`read_csv` in a separate DuckDB) or the dataset's own ground truth, so an ingest or profile bug can't show in both the expected and the actual value;
- `split`: `dev` or `heldout`;
- `review`: `reviewed_by`, `date`, `method` (`independent_sql` or `published_figure`) and `agrees`.

A file is validated on load: duplicate ids, a trap not answered through `ask`, and kind/source pairs that could never pass (a numeric item read from a driver, a categorical one from a fact) are refused.

## 2. Golden set: scoring

Free text is never judged. Each item names the one place its answer is read from, and only that place is compared, so a matching but unrelated number scores nothing:

| `source.kind` | Read from | numeric | categorical |
|---|---|---|---|
| `fact` | the report fact with that `label` | its value within tolerance | — |
| `driver` | the report's finding about a change in `metric` (no member) at `period`, by the eval's subject matcher (the period the change is at, not its before side); its first `drivers` entry | — | the driver's label |
| `ask` | the `aa ask` answer's first claim | a fact the first claim cites, within tolerance | the one member the first claim's facts name; several members, or none, is a miss |

A `driver` source names no member yet; a member-level driver item would add one.

- **Refusal:** an answer with no verified claim (with or without `notCovered`). `notCovered` beside verified claims is a caveat, not a refusal.
- **Traps** are answered through `ask` and pass only on a refusal; an answer with claims is a miss. An answerable `ask` item that is refused is a miss, and one answered with the right cited fact plus a caveat passes. The report has no separate caveat field yet; the plan's "a caveat field" is `notCovered` until one exists.
- **What counts toward the bars:** an item counts only when it is reviewed and its review `agrees`. `summarizeGolden(scores, split?)` reports numeric and categorical items, traps, and the number not counted, separately, for one split when given (the §4.7 numeric bar is on the held-out split).

## 3. Golden set: review

Under the autonomy rule (STATE, 2026-10-21) the agent stands in for the maintainer's review, independently of the author: a separate session that hasn't seen `answers.sql` re-derives each expected answer with its own query or a published figure, and checks the wording, the tolerance and the trap reason. Every golden result is labelled "agent-reviewed, not maintainer-reviewed" until the maintainer re-reviews.

**The CI mini set** (`evals/golden/coffee-roaster/golden.yaml`, six items over the committed coffee-roaster dataset) runs the harness offline in CI with the scripted planner. It is a fixture: its items carry no `review`, so none counts toward the bars. Its test runs each item's `sql` on the job's own workspace to check the fixture's expected values; that shares the engine's ingest, so it is a fixture check, not an independent re-derivation.

## 4. Golden sets

| Dataset | Dev (`golden.yaml`) | Held-out (`heldout.yaml`) | Traps | Sources |
|---|---|---|---|---|
| `online-retail-ii` (UCI Online Retail II, the 10% invoice sample) | 8 | 3 | 2 | 2 `fact`, 1 `driver`, 8 `ask` |
| `nz-card-spend` (Stats NZ card spending by industry group) | 7 | 3 | 2 | 2 `fact`, 1 `driver`, 7 `ask` |
| `coffee-roaster` (CI fixture, §3) | 6 | 0 | 1 | not reviewed, never counted |

The two real sets (M14 PR 3) cover totals by period, a share or concentration (the top ten customers' share of 2010 sales; one industry group's share of 2025 spending), the highest month, a period-over-period change, a same-month-a-year-earlier comparison, the top driver of a change, and traps the data can't answer (a margin with no cost column, an average transaction value with no transaction count, a forecast). Each answerable item's `sql` reads the raw derived file (`read_csv('FILE', all_varchar = true)` in a separate DuckDB, FILE being the file in evals/real/data), never the engine's workspace or its normalisation; a test runs every query and checks it returns `expected` and that `columns` are the file's own headers. Every item is unreviewed until the independent review of §3 adds its `review` record.

- **Runner.** `bun run eval:golden -- [--dataset <id>] [--split dev|heldout] [--model baseline|configured|<provider:model>]` (`aa eval --suite golden`) runs the dataset's engine job on the derived file as the real tier does (its answer file gives the file and options, and the confirmed metrics where it has them), asks each `ask` item's question of the finished job (`aa ask`), scores every item and prints one line per item and the bars' counts. It publishes nothing yet (the baseline report, M14 PR 8, does). It needs `bun run eval:real:fetch` first (`NO_DATA` otherwise); CI has no data, so the real-data tests are skipped there and the runner is tested on the example workbook.
- **Scripted baseline.** The baseline has no script for follow-up questions, so every `ask` item, traps included, is "no answer", a miss. Its passes are the `fact` and `driver` items the report carries.
- **Held-out rule.** `heldout.yaml` is read only by release runs (`--split heldout`), and only `evals/runner` maps a split to its file. No file under packages/ or apps/ may name `heldout.yaml` or the evals/golden folder: a test walks both trees and fails on a hit, so the engine can never see the golden questions or answers. Development runs use the dev split only.

## 5. Paired bootstrap

`pairedBootstrap(a, b, { resamples = 10000, seed })` takes per-task scores of two arms on the same tasks, forms the differences b − a, resamples them with replacement with a seeded PRNG (mulberry32), and returns the mean difference with the 2.5th and 97.5th percentiles of the resampled means: the sorted means at indices ⌊0.025·R⌋ and ⌊0.975·R⌋. `resamples` must be a whole number above 0 and every score finite. A claim that b adds accuracy is made only when the interval's low end is above 0. Unpaired or empty inputs are refused.
