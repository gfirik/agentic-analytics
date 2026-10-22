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
| `coffee-roaster` (CI fixture, §3) | 6 | 0 | 1 | not reviewed, never counted |

The two real sets (M14 PR 3) cover totals by period, a share or concentration (the top ten customers' share of 2010 sales; one industry group's share of 2025 spending), the highest month, a period-over-period change, a same-month-a-year-earlier comparison, the top driver of a change, and traps the data can't answer (a margin with no cost column, an average transaction value with no transaction count, a forecast). Each answerable item's `sql` reads the raw derived file (`read_csv('FILE', all_varchar = true)` in a separate DuckDB, FILE being the file in evals/real/data), never the engine's workspace or its normalisation; a test runs every query and checks it returns `expected` and that `columns` are the file's own headers. An item counts only once its `review` record agrees (§3); all 21 were reviewed on 2026-10-22, by an agent, not yet by the maintainer.

- **Runner.** `bun run eval:golden -- [--dataset <id>] [--split dev|heldout] [--model baseline|configured|<provider:model>]` (`aa eval --suite golden`) runs the dataset's engine job on the derived file as the real tier does (its answer file gives the file and options, and the confirmed metrics where it has them), asks each `ask` item's question of the finished job (`aa ask`), scores every item and prints one line per item and the bars' counts. It publishes nothing yet (the baseline report, M14 PR 8, does). It needs `bun run eval:real:fetch` first (`NO_DATA` otherwise); CI has no data, so the real-data tests are skipped there and the runner is tested on the example workbook.
- **Scripted baseline.** The baseline has no script for follow-up questions, so every `ask` item, traps included, is "no answer", a miss. Its passes are the `fact` items and the `driver` items whose finding carries drivers: NZ G3 passes; retail G7 misses ("no driver"), because its December 2010 orders finding is an anomaly.v1 finding, which attaches no drivers (a known engine gap, STATE).
- **Held-out rule.** `heldout.yaml` is read only by release runs (`--split heldout`), and only `evals/runner` maps a split to its file. A test walks packages/ and apps/ and fails if: a file under packages/ imports the eval runner; any file names `heldout.yaml` or the evals/golden folder (spelled as a path or as `"evals", "golden"` segments); or a file under apps/ other than the CLI (`apps/cli/src/main.ts`, the release-run entry, allow-listed by name) uses the golden API (`GOLDEN_DIR`, `goldenFile`, `loadGoldenSet`, `runGoldenSet`, `goldenEvalCommand`, `goldenDatasets`) or a `"heldout"` literal. That keeps the engine packages from reading the golden questions or answers by any route the test can see; it is a static check, not a sandbox. Development runs use the dev split only.

## 5. Paired bootstrap

`pairedBootstrap(a, b, { resamples = 10000, seed })` takes per-task scores of two arms on the same tasks, forms the differences b − a, resamples them with replacement with a seeded PRNG (mulberry32), and returns the mean difference with the 2.5th and 97.5th percentiles of the resampled means: the sorted means at indices ⌊0.025·R⌋ and ⌊0.975·R⌋. `resamples` must be a whole number above 0 and every score finite. A claim that b adds accuracy is made only when the interval's low end is above 0. Unpaired or empty inputs are refused.

## 6. The model matrix

`aa eval --suite smoke|full --models a,b,c` (`evalMatrix` in evals/runner/src/cli.ts) runs the suite once per model, one after the other, each with the same arguments as a single `--model` run (`--small-model`, `--keep-reports`, `--note`, `--only`), and writes each as its own results row named by the model. A model spec is `baseline`, `configured`, or a provider route used for every role (`openai-compatible:groq:openai/gpt-oss-120b`). A model that fails (no client, a provider error) is reported and the next one runs; the exit code is non-zero when any model failed or missed a bar. Nothing is averaged across models: each family's results stand on their own (analyst-grade §4.4). `--models` refuses `--model`, `--label`, `--passes`, `--replay-drafts` and `--suite real`, takes provider routes or `baseline` (not `configured`, the nightly's own row), and needs at least two models that name distinct results files. With `--keep-reports dir`, each model's reports go to their own subfolder `dir/<model slug>[-small]-<suite>/`, so one model never overwrites another's. One `--note` applies to every model's row.


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

**With other flags.** `--repeat` goes with `--suite smoke|full`, `--model` (any, `baseline` included), `--models` (the matrix runs each model's N runs in turn and prints one agreement line per model), `--only` (which still needs a `--results-dir` outside `evals/results`), `--label`, `--note`, `--small-model`, `--replay-drafts` (with `baseline`) and `--keep-reports dir` (each run's reports in `dir/run-<k>/`, under the model's subfolder in a matrix). It refuses a count that isn't a whole number ≥ 2, `--suite real` (the real tier has its own runner), and `--passes` (N whole runs in one go, not one run carried over nights).

**CI path.** evals/runner/test/repeat.test.ts checks the measures on hand-computed snapshots (four jobs × three runs with known disagreements, and an n/a job), and runs `evalRepeat` offline with a FakeModel whose second run writes no explanation and proposes no action: (a) and (b) agree, (d) and (e) don't, and every disagreement row shows runs 1 and 3 equal and run 2 different. apps/cli/test/eval-models.test.ts runs the real model client against a stubbed transport and shows the call records are `cached: false` across repeats with the cache off (nothing read or written), and `[false, true, true]` with it on.

## 8. Ablation: the same model with and without the engine

`bun run eval:ablation -- [--arms A,B,C] [--suite smoke|golden] [--model baseline|<provider:model>] [--dataset id] [--context tokens] [--no-tools] [--results-dir dir]` (evals/ablation, `@agentic-analytics/eval-ablation`; analyst-grade §4.5, §6.4). The prompts (`src/prompts.ts`) and the harness are published there so anyone can rerun them.

### 8.1 Arms and tasks

| Arm | What the model gets | Code |
|---|---|---|
| A. Model alone | The job's files as text: each ingested table as CSV rows, each document's text (email headers included), and the task; cut to the context window minus the prompt (§8.2) | `runArmA` |
| B. Model + SQL | The same tables in a locked DuckDB and one tool, `run_sql`; the table list with columns and row counts; the documents' names only (a text-to-SQL analyst reads tables) | `runArmB` |
| C. The engine | The full pipeline (`runJob`, then `askJob` for `ask` items) | `runArmC` in src/run.ts |

- **The same for every arm:** the tasks, the model (`--model` serves every role in every arm; `configured` is refused, since its roles may differ), the scoring, and the retry budget: 2 retries on an answer that isn't the fixed JSON shape or on a tool error. Arm A's retries are `generateObject`'s validation retries (`maxRetries: 2`); arm B's tool errors and invalid final replies share one budget of 2, after which the next tool error stops the task and an invalid reply is final (a miss).
- **The tables** are the engine's own: the files go through `ingest` and `normalizeTable` (monthly grain), so every arm sees the same rows and column names. Arm B's tables keep the engine's helper columns `_row`, `_is_total` and `_period`, explained in its prompt.
- **Tasks.** Golden (`--suite golden`): one question per dev-split item, whatever its `source` (arms A and B have no report, so every item is asked). The CI mini set is `--dataset coffee-roaster`; without `--dataset`, every real dataset with a dev golden set (after `bun run eval:real:fetch`; `NO_DATA` otherwise). Held-out items are never read here. Smoke (`--suite smoke`): one "what changed" task per dataset (coffee_roaster-v1, saas-v2, restaurant-v3), answered as a list of findings.
- **A model that can't call tools** (`--no-tools`, or a profile with `toolCalling: "none"`) runs arm A only; arm B is reported as skipped.

### 8.2 Containment

Arms A and B are eval-only controls, not the agent, and break two rules on purpose: arm B runs model-written SQL (AGENTS §2.6) and arm A feeds raw untrusted text to a model (§2.5). The fence:

- **Where:** `run_sql` and the arms live in evals/ablation only, never in `packages/agent/tools`. test/guard.test.ts fails if any code file under packages/ or apps/ imports `@agentic-analytics/eval-ablation` or names `evals/ablation`, or if `run_sql` appears under packages/. The entry is its own script (`bun run eval:ablation`), not an `aa` subcommand, so no allow-list is needed.
- **Arm B's database** is built per run in two phases (`buildSourceDatabase`, `SqlSandbox.open`): a writable instance loads the ingested source tables only (no metric definitions, facts or document chunks; a test lists them: `t_t1`, `t_t2`, `t_t3` for coffee-roaster) and is closed; then the file is reopened locked. The per-run folder (database, temp directory) is created under the OS temp dir and deleted after the run, whatever happened (`cleanedUp` in the result; tested).
- **The locked open** applies nine options in this order: `temp_directory` (the per-run dir), `max_temp_directory_size` ("1GB"), `access_mode` ("READ_ONLY"), `enable_external_access` ("false"), `autoinstall_known_extensions` ("false"), `autoload_known_extensions` ("false"), `memory_limit` ("1GB"), `threads` ("2"), `lock_configuration` ("true"). `temp_directory` must come before `enable_external_access=false`, and the lock last. **Deviation from the plan, checked on @duckdb/node-api 1.5.6:** `max_temp_directory_size` given to `DuckDBInstance.create` reads back but is not enforced (a sort wrote 87 MB of spill past a 1 MB cap), while the same value set with `SET` is. So `create` takes the first eight options, then `SET max_temp_directory_size` re-applies the cap and `SET lock_configuration = true` locks it, before any model-written statement runs. A test reads `current_setting` back for all nine and compares normalised values (sizes parsed to bytes, `memory_limit` reads "953.6 MiB"; booleans and `access_mode` case-folded), and checks the order.
- **Per statement:** a timer calls `connection.interrupt()` after `timeoutMs` (10 s). Results are read with `stream()` and `fetchChunk`, counting rows and bytes (as JSON) as they come, and stopped past 200 rows or 32 KiB.
- **Typed tool errors** (`AblationError`): `SQL_REFUSED` (DuckDB's permission, read-only and locked-configuration errors), `SQL_TIMEOUT`, `SQL_OUT_OF_MEMORY`, `SQL_OUT_OF_SPACE` (spilling past the temp cap surfaces as "failed to offload"), `RESULT_TOO_LARGE`, `SQL_ERROR` (syntax, unknown names). `run_sql` returns them to the model as `{ error: { code, message } }`; each uses one retry.
- **Tested from a scripted arm B, each refused:** `COPY … TO`, `read_csv('/…')`, `read_text('/etc/hostname')`, `read_blob`, `glob('/*')`, `INSTALL`, `LOAD httpfs`, `ATTACH`, `SET enable_external_access=true`, `SET lock_configuration=false`, `SET memory_limit=…`, a settings `PRAGMA`, `CREATE TABLE`. A cross join of `range()` is stopped by the timeout (`SQL_TIMEOUT`); `list()` over 400M rows fails with `SQL_OUT_OF_MEMORY`; a 12M-row sort over the memory limit completes and leaves spill files in the per-run temp directory, and the same sort on a test-only instance with `max_temp_directory_size` 1 MB fails with `SQL_OUT_OF_SPACE`. A `CREATE TEMP TABLE` is allowed: it lives in the instance's bounded memory and goes with it.
- **Arm A's text** never reaches an engine prompt or the engine's cache: every arm has its own `ModelClient` (`armModelClient`) built with no response cache and its own call log (`<results>/ablation/<run>.calls.jsonl`, never data/logs/model-calls.jsonl). A test runs arm A twice through that client on a stubbed transport and checks both calls were live, both are in the arm's log, and the engine's cache folders (AA_MODEL_CACHE and evals/.cache) are unchanged.

**Arm A's cut** (`armAText`): documents first, each whole or left out; then every table shows its first k rows (all of them when it has fewer), k the largest that fits the context window minus the system prompt, the answer schema, the question and 1,024 tokens for the answer (estimated tokens, `estimateTokens`). The cut is a sentence in the input ("t_t1 (sales.xlsx#Orders) shows rows 1–843 of 11564 … Answers about the whole data rest on this sample") and beside arm A's results. `--context` sets the window (default: the model's profile, else 32,768).

### 8.3 The answer shapes

Arms A and B answer in a fixed JSON shape (`QuestionAnswer`, `ChangesAnswer` in src/prompts.ts):

- a question: `answer` (prose with the numbers in digits), `member` (for a "which" question), `refused`, `caveat`, and for arm B `sql` (the statements its numbers come from);
- "what changed": `findings` (at most 10, most important first), each with `metric`, `member` (`{dimension, member}` or null), `before` and `period` (YYYY-MM), `direction`, `drivers` (biggest first) and `summary`; `refused`, `caveat`.

Arm B's final reply is parsed as JSON (the whole reply, a fenced block, or the outermost braces).

### 8.4 Measures

Each has a hand-computed test (test/measures.test.ts, test/numbers.test.ts).

- **Numbers in prose** (`proseNumbers`): thousands separators, decimals, a currency sign, `k`/`M`/`bn`/`thousand`/`million`/`billion`, `%`, and an explicit sign (ASCII or "−"). Excluded: dates and periods (ISO months and days, d/m/y, quarters, month-name dates with a day 1–31, fiscal years, a bare whole number 1900–2100), ordinals ("3rd"), rank sizes ("top 10", "the 5 largest") and numbers echoed from the question. Digits inside a name (`t_t1`, `Q2`) are never read. Words ("ten") are not read.
- **Readings** of a prose number when compared: itself; for an unsigned number also its negative ("fell by 7,900" for −7,900); for a percent also the fraction. This lenient reading favours arms A and B.
- **Numeric accuracy:** a numeric item passes when some claimed number, in one of its readings, is within the item's tolerance of the expected answer. **Categorical:** the `member` field equals the expected answer, case-insensitively. Arm C is scored by `scoreGoldenItem` (§2).
- **Trap pass rate:** a trap passes only on `refused: true`; an answer with a caveat is not a refusal. An answerable item that is refused is a miss.
- **Unsupported-number rate** (arms A and B, golden): a claimed number is supported when one of its readings is within the item's tolerance, widened to at least 0.5% (prose rounds), of a value in the support set: the dataset's golden answers, arm C's fact values for the same job (its report and its `ask` answers; absent when arm C did not run, which the page states), and the numeric source cells of the columns the item names (`columns`, matched by SQL name or original header). The rate is also reported without source cells. This set is wider than analyst-grade's "the data or the golden set", which favours arms A and B (the conservative direction). Arm C's rate is not computed: every engine number is a fact with a computation.
- **Driver accuracy, planted recall@5, distractor FP rate** (smoke): each finding becomes the scorer's subject from its structured fields (metric through `armMetric`: snake_case, plain sales words → `revenue`, order counts → `orders`, refund or return rates → `refund_rate`; the member's dimension in snake_case; periods at the key's grain), then `matchesPlanted` and `matchesDistractor` from the eval's scorer decide, as for the engine. Recall counts an event found among the top 5 with the correct driver (the first `drivers` entry, or an accepted alternative). Arm C is scored by `scoreReport`.
- **Citation validity** (arm B, golden): the answer's citations are its `sql` list (or every statement it ran successfully, when it lists none). Valid when every cited statement is one it ran successfully, re-running it on a fresh locked open of the same file gives the rows it saw, and every number the answer claims is in a re-run result (support tolerance, readings). Answers with no claimed number are not counted.
- **Tokens and time** per arm: the usage the client reports (arm C's job and questions included), and wall seconds.
- **Paired differences:** C − A, C − B and B − A over the tasks both arms ran (golden items; smoke planted events, scored 1 when found with the driver), with `pairedBootstrap` (§5). "Adds accuracy" is printed only when the interval's low end is above 0, and never for a scripted run.

### 8.5 Output and the scripted run

Each run writes `<results>/ablation/<date>-<model>-<suite>[-<dataset>].json` (the `AblationResult`) and `.md`: the measures per arm side by side, arm A's cuts, the paired differences with their intervals, and every task's score. `--model baseline` runs offline: arms A and B answer from canned FakeModel scripts built from the answer keys and golden items (src/scripted.ts), and arm C runs the scripted planner (`coffeePlanner` on the mini set, `baselineModel` elsewhere). The page labels it a harness check, not an engine-vs-model comparison. Scripted runs are gitignored (`evals/results/ablation/*-baseline-*`), like baseline smoke runs.

**CI path.** test/ablation.test.ts runs scripted arms A, B and C on the mini golden set and arms A and B on the smoke suite, with expected measures worked out from the canned answers; test/sandbox.test.ts, test/arm-a.test.ts and test/guard.test.ts cover §8.2.
