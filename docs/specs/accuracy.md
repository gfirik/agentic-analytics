# Spec: accuracy measurement (M14)

The tools that put the engine's accuracy in numbers (docs/plans/analyst-grade.md §4, docs/plans/m14.md). Each section lands with the code that implements it; sections for the ablation and the held-out sets are added by their PRs.

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

## 5. Paired bootstrap

`pairedBootstrap(a, b, { resamples = 10000, seed })` takes per-task scores of two arms on the same tasks, forms the differences b − a, resamples them with replacement with a seeded PRNG (mulberry32), and returns the mean difference with the 2.5th and 97.5th percentiles of the resampled means: the sorted means at indices ⌊0.025·R⌋ and ⌊0.975·R⌋. `resamples` must be a whole number above 0 and every score finite. A claim that b adds accuracy is made only when the interval's low end is above 0. Unpaired or empty inputs are refused.

## 6. The model matrix

`aa eval --suite smoke|full --models a,b,c` (`evalMatrix` in evals/runner/src/cli.ts) runs the suite once per model, one after the other, each with the same arguments as a single `--model` run (`--small-model`, `--keep-reports`, `--note`, `--only`), and writes each as its own results row named by the model. A model spec is `baseline`, `configured`, or a provider route used for every role (`openai-compatible:groq:openai/gpt-oss-120b`). A model that fails (no client, a provider error) is reported and the next one runs; the exit code is non-zero when any model failed or missed a bar. Nothing is averaged across models: each family's results stand on their own (analyst-grade §4.4). `--models` refuses `--model`, `--label`, `--passes`, `--replay-drafts` and `--suite real`, takes provider routes or `baseline` (not `configured`, the nightly's own row), and needs at least two models that name distinct results files. With `--keep-reports dir`, each model's reports go to their own subfolder `dir/<model slug>[-small]-<suite>/`, so one model never overwrites another's. One `--note` applies to every model's row.


## 7. Repeated runs (`--repeat`)

`aa eval --suite smoke|full --repeat N` (`evalRepeat` in evals/runner/src/cli.ts, the measures in evals/runner/src/repeat.ts) runs the suite N times (N a whole number ≥ 2) with the same model and the same arguments, and measures how often the runs agree (analyst-grade §4.3). The temperature is the provider's default.

**The response cache is off.** `--repeat` implies `--no-cache`: the cache is never built, read or written, so runs 2..N can't replay run 1 and every call is live. `--no-cache` on its own does the same for any `aa eval` run (a fresh measurement of a model with no earlier answers). Each run records its provider calls and how many were cached (0 with the cache off; a non-zero count prints a warning, as its agreement would be overstated). The scripted baseline makes no provider calls; its result says `cache: "n/a"`.

**What is compared.** Each run's shipped report.json is reduced, per job, to a snapshot:

- the facts, by label, each label's values sorted (a label can repeat). Facts that rest on a scenario parameter the model chose (`fn` `scenario_param` or `impact.v1:<type>`) are left out: they are a choice within bounds, covered by (e), not a number that should be deterministic;
- the top 5 findings, each as a key `(template, metric, period, member)` with its top driver and cause grade. The template is the one the first claim's insight fact names (`I3 anomaly.v1 revenue 2026-04:…`), else the finding type; metric, period and member are the scorer's subject (EVALS §2: the metric by its concept, the period the change is at). The top driver is the first `drivers` label (trimmed), or "none"; the grade is the highest `causal_grade` among the finding's claims ("observed" when none states one);
- the top recommendation's scenario type (`impact.method` without `impact.v1:`), or "none".

**The five measures.** For each job, over its N snapshots:

| Measure | The runs agree when |
|---|---|
| (a) numbers | every fact label has the same values in every run that has it (exact equality). A label only some runs have is a findings difference, not a changed number |
| (b) findings | the top-5 keys are the same multiset (rank order may differ) |
| (c) driver | each key in every run's top 5 has the same top driver in every run (compared in rank order when a key repeats) |
| (d) cause grade | each such key has the same grade in every run |
| (e) action | the top recommendation's scenario type is the same |

A job that failed in any run agrees on nothing. (c) and (d) are n/a for a job with no key in every run's top 5 (a findings difference is counted once, under (b)). **The reported value** per measure is the share of jobs where all N runs agree, n/a jobs left out, beside the §4.7 launch bar (100% / 95% / 95% / 90% / 90%; the bar is set over 5 runs). The command exits 1 when a run left a job unfinished or a measure misses its bar.

**Output.** Each `--repeat` run writes `<results dir>/repeat/<date>-<model>[-small]-<suite>-repeat<N>.json` (the `RepeatResult`: the runs, the measures, each job's agreement and the disagreements) and, beside it, the same name in `.md`: the measures, then every disagreement side by side, one row per item (the fact label, the finding key, or the top recommendation) and one column per run ("—" where a run has no such item). The N runs write no results rows and leave RESULTS.md alone: one run of N is not the model's result, and N rows of one name would replace each other. Baseline smoke repeats are gitignored like baseline smoke runs.

**With other flags.** `--repeat` goes with `--suite smoke|full`, `--model` (any, `baseline` included), `--models` (the matrix runs each model's N runs in turn and prints one agreement line per model), `--only` (which still needs a `--results-dir` outside `evals/results`), `--label`, `--note`, `--small-model`, `--replay-drafts` (with `baseline`) and `--keep-reports dir` (each run's reports in `dir/run-<k>/`, under the model's subfolder in a matrix). It refuses a count that isn't a whole number ≥ 2, `--suite real` (the real tier has its own runner), and `--passes` (N whole runs in one go, not one run carried over nights).

**CI path.** evals/runner/test/repeat.test.ts checks the measures on hand-computed snapshots (four jobs × three runs with known disagreements, and an n/a job), and runs `evalRepeat` offline with a FakeModel whose second run writes no explanation and proposes no action: (a) and (b) agree, (d) and (e) don't, and every disagreement row shows runs 1 and 3 equal and run 2 different. apps/cli/test/eval-models.test.ts runs the real model client against a stubbed transport and shows the call records are `cached: false` across repeats with the cache off (nothing read or written), and `[false, true, true]` with it on.
