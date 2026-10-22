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
- `review`: `reviewed_by`, `date`, `method` (`independent_sql` or `published_figure`) and `agrees`. On a trap, which has no answer to re-derive, `independent_sql` means the reviewer read the file's columns itself and agrees none of them answers the question.

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
| `hotel-bookings` (Data in Brief hotel booking demand, both hotels in one file) | 8 | 3 | 2 | 2 `fact`, 9 `ask` |
| `eia-861m` (EIA monthly retail sales by state and sector) | pending | pending | 2 drafted | DEFERRED: no file pinned yet, 10 questions drafted in `draft.yaml`, nothing loaded or scored |
| `coffee-roaster` (CI fixture, §3) | 6 | 0 | 1 | not reviewed, never counted |

The two real sets (M14 PR 3) cover totals by period, a share or concentration (the top ten customers' share of 2010 sales; one industry group's share of 2025 spending), the highest month, a period-over-period change, a same-month-a-year-earlier comparison, the top driver of a change, and traps the data can't answer (a margin with no cost column, an average transaction value with no transaction count, a forecast). Each answerable item's `sql` reads the raw derived file (`read_csv('FILE', all_varchar = true)` in a separate DuckDB, FILE being the file in evals/real/data), never the engine's workspace or its normalisation; a test runs every query and checks it returns `expected` and that `columns` are the file's own headers. An item counts only once its `review` record agrees (§3); all 21 were reviewed on 2026-10-22, by an agent, not yet by the maintainer.

The hotel set (M14 PR 4) adds a rate business: room revenue (ADR × nights over the bookings not cancelled, by arrival month, as the real tier's confirmed metric defines it), cancellation rates by hotel, deposit type and market segment, a channel's share of bookings, which hotel earned more in a month, a month-over-month change, and traps for a profit margin (no costs in the file) and a forecast. Its 11 items were reviewed by a separate agent on 2026-10-22 (all agree, so all count), not yet by the maintainer. EIA-861M is DEFERRED: www.eia.gov did not answer from the machine that built the set, so no file is pinned and its questions are a draft (`evals/golden/eia-861m/draft.yaml`, no `expected` filled in) that nothing loads. **Golden v1 has three real datasets until EIA-861M is pinned** (the command is in STATE "Deferred checks").

- **Runner.** `bun run eval:golden -- [--dataset <id>] [--split dev|heldout] [--model baseline|configured|<provider:model>]` (`aa eval --suite golden`) runs the dataset's engine job on the derived file as the real tier does (its answer file gives the file and options, and the confirmed metrics where it has them), asks each `ask` item's question of the finished job (`aa ask`), scores every item and prints one line per item and the bars' counts. It publishes nothing yet (the baseline report, M14 PR 8, does). It needs `bun run eval:real:fetch` first (`NO_DATA` otherwise); CI has no data, so the real-data tests are skipped there and the runner is tested on the example workbook.
- **Scripted baseline.** The baseline has no script for follow-up questions, so every `ask` item, traps included, is "no answer", a miss. Its passes are the `fact` items and the `driver` items whose finding carries drivers: NZ G3 passes; retail G7 misses ("no driver"), because its December 2010 orders finding is an anomaly.v1 finding, which attaches no drivers (a known engine gap, STATE). The hotel set has no driver item (the engine picks the dimension a driver is read from, and a question can't fairly name one the engine didn't choose); its two `fact` items pass.
- **Held-out rule.** `heldout.yaml` is read only by release runs (`--split heldout`), and only `evals/runner` maps a split to its file. A test walks packages/ and apps/ and fails if: a file under packages/ imports the eval runner; any file names `heldout.yaml` or the evals/golden folder (spelled as a path or as `"evals", "golden"` segments); or a file under apps/ other than the CLI (`apps/cli/src/main.ts`, the release-run entry, allow-listed by name) uses the golden API (`GOLDEN_DIR`, `goldenFile`, `loadGoldenSet`, `runGoldenSet`, `goldenEvalCommand`, `goldenDatasets`) or a `"heldout"` literal. That keeps the engine packages from reading the golden questions or answers by any route the test can see; it is a static check, not a sandbox. Development runs use the dev split only.

## 5. Paired bootstrap

`pairedBootstrap(a, b, { resamples = 10000, seed })` takes per-task scores of two arms on the same tasks, forms the differences b − a, resamples them with replacement with a seeded PRNG (mulberry32), and returns the mean difference with the 2.5th and 97.5th percentiles of the resampled means: the sorted means at indices ⌊0.025·R⌋ and ⌊0.975·R⌋. `resamples` must be a whole number above 0 and every score finite. A claim that b adds accuracy is made only when the interval's low end is above 0. Unpaired or empty inputs are refused.

## 6. The model matrix

`aa eval --suite smoke|full|heldout --models a,b,c` (`evalMatrix` in evals/runner/src/cli.ts) runs the suite once per model, one after the other, each with the same arguments as a single `--model` run (`--small-model`, `--keep-reports`, `--note`, `--only`), and writes each as its own results row named by the model. A model spec is `baseline`, `configured`, or a provider route used for every role (`openai-compatible:groq:openai/gpt-oss-120b`). A model that fails (no client, a provider error) is reported and the next one runs; the exit code is non-zero when any model failed or missed a bar. Nothing is averaged across models: each family's results stand on their own (analyst-grade §4.4). `--models` refuses `--model`, `--label`, `--passes`, `--replay-drafts` and `--suite real`, takes provider routes or `baseline` (not `configured`, the nightly's own row), and needs at least two models that name distinct results files. With `--keep-reports dir`, each model's reports go to their own subfolder `dir/<model slug>[-small]-<suite>/`, so one model never overwrites another's. One `--note` applies to every model's row.


## 7. Repeated runs (`--repeat`)

`aa eval --suite smoke|full --repeat N` (`evalRepeat` in evals/runner/src/cli.ts, the measures in evals/runner/src/repeat.ts) runs the suite N times (N a whole number ≥ 2) with the same model and the same arguments, and measures how often the runs agree (analyst-grade §4.3). The temperature is the provider's default.

**The response cache is off.** `--repeat` implies `--no-cache`: the cache is never built, read or written, so runs 2..N can't replay run 1 and every call is live. `--no-cache` on its own does the same for any `aa eval` run (a fresh measurement of a model with no earlier answers). Each run records its provider calls and how many were cached (0 with the cache off). A non-zero count prints a warning and records `cache: "on"`, and the run fails, as its agreement would be overstated; `cache: "off"` is measured from those counts, not assumed. The scripted baseline makes no provider calls; its result says `cache: "n/a"`.

**What is compared.** Each run's shipped report.json is reduced, per job, to a snapshot:

- the facts, by label, each label's values sorted (a label can repeat). Facts that rest on a scenario parameter the model chose (`fn` `scenario_param` or `impact.v1:<type>`) are left out: they are a choice within bounds, covered by (e), not a number that should be deterministic;
- the top 5 findings, each as a key `(template, metric, period, member)` with its top driver and cause grade. The template is the one the first claim's insight fact names (`I3 anomaly.v1 revenue 2026-04:…`), else the finding type; metric, period and member are the scorer's subject (EVALS §2: the metric by its concept, the period the change is at). The top driver is the first `drivers` label (trimmed), or "none"; the grade is the highest `causal_grade` among the finding's claims ("observed" when none states one);
- the top recommendation's scenario type (`impact.method` without `impact.v1:`), or "none".

**The five measures.** For each job, over its N snapshots:

| Measure | The runs agree when |
|---|---|
| (a) numbers | every fact label has the same values in every run that has it (exact equality). A label only some runs have isn't a changed number: it counts under (b) when it belongs to a top-5 finding, and under no measure otherwise |
| (b) findings | the top-5 keys are the same multiset (rank order may differ) |
| (c) driver | each key in every run's top 5 has the same top driver in every run (compared in rank order when a key repeats) |
| (d) cause grade | each such key has the same grade in every run |
| (e) action | the top recommendation's scenario type is the same |

A job that failed in any run agrees on nothing. (c) and (d) are n/a for a job with no key in every run's top 5 (a findings difference is counted once, under (b)). **The reported value** per measure is the share of jobs where all N runs agree, n/a jobs left out, beside the §4.7 launch bar (100% / 95% / 95% / 90% / 90%; the bar is set over 5 runs). The command exits 1 when a run served a call from the cache, left a job unfinished or a measure misses its bar.

**Output.** Each `--repeat` run writes `<results dir>/repeat/<date>-<model>[-small]-<suite>-repeat<N>.json` (the `RepeatResult`: the runs, the measures, each job's agreement and the disagreements) and, beside it, the same name in `.md`: the measures, then every disagreement side by side, one row per item (the fact label, the finding key, or the top recommendation) and one column per run ("—" where a run has no such item). The N runs write no results rows and leave RESULTS.md alone: one run of N is not the model's result, and N rows of one name would replace each other. Baseline smoke repeats are gitignored like baseline smoke runs.

**With other flags.** `--repeat` goes with `--suite smoke|full|heldout`, `--model` (any, `baseline` included), `--models` (the matrix runs each model's N runs in turn and prints one agreement line per model), `--only` (which still needs a `--results-dir` outside `evals/results`), `--label`, `--note`, `--small-model`, `--replay-drafts` (with `baseline`) and `--keep-reports dir` (each run's reports in `dir/run-<k>/`, under the model's subfolder in a matrix). It refuses a count that isn't a whole number ≥ 2, `--suite real` (the real tier has its own runner), and `--passes` (N whole runs in one go, not one run carried over nights).

**CI path.** evals/runner/test/repeat.test.ts checks the measures on hand-computed snapshots (four jobs × three runs with known disagreements, and an n/a job), and runs `evalRepeat` offline with a FakeModel whose second run writes no explanation and proposes no action: (a) and (b) agree, (d) and (e) don't, and every disagreement row shows runs 1 and 3 equal and run 2 different. apps/cli/test/eval-models.test.ts runs the real model client against a stubbed transport and shows the call records are `cached: false` across repeats with the cache off (nothing read or written), and `[false, true, true]` with it on.

## 9. The held-out generated set

(§8 is the ablation's, M14 PR 6.) The offline baseline's detection and ranking rules were tuned on the same 30 generated businesses they are scored on (STATE, M13a row), so their scores are optimistic for unseen data. The held-out generated set is a second, separate set from the same generator (evals/generator/src/heldout.ts, analyst-grade §4.6), read only by release runs.

**What it holds (14 datasets).**
- **New seeds:** each of the 10 development archetypes once, in variants v1, v2, v3 in turn, with a new seed (`20270000 + 100 × (archetype index + 1) + variant`, no seed of the 30): ids `<archetype>-v<k>-heldout`. The templates and planted months are the 30's; the noise, account shares and order splits are new.
- **Two archetypes no heuristic was written against**, two variants each. They differ from all 30 in business shape, column names, row grain, file layout, date format, currency, series length and end date:

| | `tool_hire` (Summit Tool & Plant Hire, GBP) | `car_wash` (Clearwater Car Wash, AUD) |
|---|---|---|
| Row grain | one hire-contract line: depot, account, equipment group, item, Qty, hire days, list day rate, net amount after the account discount, off-hire date | one site × wash programme × trading day, already summed by the till: wash count, net sales, refunds (money, not a status) |
| Dimensions | depot (4), account (5 trade + cash), equipment group, item | site (4), programme (4) |
| v1 | `hire-ledger.xlsx`, Excel date cells, a `Depots` reference sheet; 22 months to 2026-08 | `daily-takings.csv`, ISO dates, 12,656 rows; 26 months to 2026-05 |
| v2 | `hires.csv`, dates written `3 Mar 2026`; 16 months to 2026-08 | `takings.xlsx`, Excel date cells, a `Prices` reference sheet; 14 months to 2026-04 |
| Seasonality | every December a Christmas shutdown (about 30% lower) | every January the southern summer holidays (about 20% higher); weekends and rainy days in the daily rows |
| Planted, v1 | P1 a depot closes after a fire (revenue, driver `depot`); P2 an account's framework agreement more than triples its hires (an **improvement**, a concentration build-up, driver `account`) | P1 a refurbished brush gantry raises one site's re-wash refunds (`refund_rate`, driver `site`); P2 roadworks cut one site's washes by almost half (revenue, driver `site`) |
| Planted, v2 | P1 a bigger Access fleet raises one equipment group's revenue (improvement, member `equipment_group`); P2 a key account moves all its hire, across every depot, to a competitor after a tender (revenue, driver `account`) | P1 a price rise moves most of one programme's buyers to cheaper ones, with total revenue nearly flat (member `programme`); P2 a competitor opens near one site (revenue, driver `site`) |
| Distractors | D1 a 3% blip for one depot with a coincidental yard note; every December | D1 a 3% blip for one site with a coincidental site note; every January |
| Quality | v1: a negative Qty (`negative_quantity`), an off-hire date in 2062 (`future_date`); v2: seven empty net amounts (`missing_value`) | v1: five days of empty wash counts at one site (`missing_value`); v2: a negative wash count (`negative_quantity`) |

Each has cause documents (an email, a PDF letter or notice, a DOCX log, a text clipping) and an irrelevant policy. Answer keys use the 30's format (`AnswerKey`, docs/EVALS.md §1) with `split: heldout` and `generator_version: 2`, are versioned in `evals/datasets/heldout/<id>/answers.yaml` (files gitignored, rebuilt by `bun run --filter @agentic-analytics/eval-generator build:heldout`), and their files' SHA-256s are pinned in `evals/generator/heldout-manifest.json`. Scoring is the 30's (evals/runner/README.md): a member key's dimension is the column's name as the engine normalizes it (`equipment_group`).

**The 30 stay byte-identical.** The held-out code is a separate module; `generateDataset` is unchanged and the 30 keep `generator_version: 1`. evals/generator/test/heldout.test.ts pins the digests of the 30's manifest and answer keys as they were on main before this set existed, computed after the held-out set is generated in the same process: SheetJS keeps a global number-format table, so a custom date format in a held-out workbook changed every workbook written after it until the held-out workbooks used Excel's built-in date format 14.

**How it is used.**
- **Release runs:** `aa eval --suite heldout --model <m>` (`bun run eval -- --suite heldout …`). It takes the same flags as `full` (`--small-model`, `--keep-reports`, `--label`, `--passes`, `--models`, `--repeat`), and a published run is its own `heldout` row in RESULTS.md, after the full suites. The §4.7 launch bars on planted recall and distractor false positives apply to this set.
- **CI path:** the generator's tests (determinism, the pinned hashes, every planted event recomputed from the rows, each quality issue at the cell its key names, clean ingest), and one held-out dataset (`tool_hire-v1`, `HELDOUT_SMOKE`) in the smoke suite, run offline with the baseline on every PR. The smoke test checks only the invariants on it (the job completes, no number mismatch, no definition violation) and scores it; it never asserts what is found, so no CI check makes it a development target.
- **Development runs** (`--suite full`, the nightly) never include it.

**Held-out rule.** Like the golden held-out guard (§4), a static test (evals/runner/test/heldout-guard.test.ts) walks packages/ and apps/ and fails if a file under packages/ imports the dataset generator, if any file names the held-out API (`heldoutDatasets`, `HELDOUT_ARCHETYPES`, `HELDOUT_SMOKE`, `HELDOUT_GENERATOR_VERSION`, `allGeneratedDatasets`) or its answer-key folder, manifest or module, or if any code file names the two archetypes or their businesses. The CLI chooses the suite by name (`"heldout"`) and evals/runner maps it to the datasets, so no allow-list entry is needed. It is a static check, not a sandbox. Engine fixes found on this set are measured on it again only at the next release run; a rule tuned to it would make it development data, and the next held-out set would need new archetypes.

**First offline run (baseline, 2026-10-22).** `bun run eval -- --suite heldout --model baseline --results-dir <dir>`: 14/14 jobs, 0 mismatches, planted recall@5 75.0% (18 of 24: 15 of 16 on the reseeded businesses, 3 of 8 on the new archetypes), driver 100%, cause grade 83.3%, distractor FP 11.5% (3 of 26), quality recall 100%, relevance 85.7%; the development full suite's baseline is 96.0% recall and 0% FP. What the new archetypes miss: the fallback drafts no refund-rate metric from a money column named `Refunds` (car_wash-v1 P1); for three events (Brookvale Homes' agreement, Ringway's roadworks, the Harbour Rd competitor) the report states the right member's year-on-year change but not the whole metric's change at the event's month with that member as its driver, which is what the key asks (the 30's P1 rule); and the Access fleet improvement is not reported. These are engine gaps to measure again at the next release run, not rules to add for this set. Not published as a row: a release run publishes it (M14 PR 8, the baseline report).
