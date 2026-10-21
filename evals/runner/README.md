# @agentic-analytics/eval-runner

The eval runner and scoring (docs/EVALS.md §2–§4). It runs each dataset as a full job, scores the report against the dataset's answer key, writes `evals/results/<date>-<model>-<suite>.json`, and regenerates `evals/RESULTS.md`.

## Scoring

- **Subject of a finding:** read from the fact labels of its first (code-written) claim: the metric, the member if any, and the compared periods (before → after). Matching never looks at wording, so a model can't score by writing the right words.
- **Planted event found:** a top-5 finding has the same metric (or the slice of the channel the event is in, e.g. `wholesale_revenue`) and the same member. Its comparison must span the event: before < event ≤ after. A lost client therefore also counts in a June-on-June drop, but a comparison entirely before or entirely after the event does not.
- **Driver:** the top entry of a matching finding's structured `drivers` list (built by code from the decomposition) is the expected member or an accepted alternative (the key client's channel).
- **Planted recall@5** counts an event only when it is found *with the correct driver* (EVALS §2).
- **Cause:** a matching finding has a claim with grade ≥ the expected grade that cites the expected document.
- **Recommendation relevance:** per completed dataset with good actions in its key. It passes only when the top recommendation is about a matching finding and uses one of the event's good scenario types; a top recommendation about anything else is a miss.
- **Distractor reported:** a finding at the distractor's period on its metric, on a metric it also moves (`also`: orders for a seasonal peak), or on a slice of either.
- **Quality issue found:** a data-quality item of the same kind cites the same file.
- Number mismatches, citation precision, definition adherence and grounding come from the report's verification summary, or from a job that failed with `RECOMPUTE_MISMATCH`/`REDERIVE_MISMATCH`.

## Baseline model

`baselineModel()` is a scripted heuristic (FakeModel): a keyword extractor, a rule-based planner and a word-overlap judge, with no LLM. It lets the whole harness run end to end offline (the smoke suite in CI).

Its rules were written knowing the generator's document templates: a sentence with "after" and "pausing" reads as a stated cause. Its cause-grade and action scores are therefore optimistic. It checks plumbing, not model quality, and RESULTS.md says so.

## Public API

- `runSuite({ suite, model, modelName, embedder, smallModel?, datasets?, keepReports? })` and `suiteDatasets(suite)`. With `keepReports` (`aa eval --keep-reports dir`), each report is kept as `<dir>/<dataset>.json` and each job's drafted metrics as `<dir>/<dataset>.metrics.drafted.json`, also when the job failed (`keepDraftedMetrics`; the job folder itself is temporary). `aa eval --model baseline --replay-drafts dir` reads those drafts back (`replayedDrafts(dir, dataset)`; a dataset without a kept model draft uses the scripted one; an unreadable file is `BAD_RESULTS`): `baselineModel({ small, drafts })` answers the metric-draft request with them, so detection, ranking and the findings cap run under a real model's metrics, offline and deterministic. The CLI needs a `--results-dir` outside `evals/results` for it (a replay is never a published row), and `evalCommand` refuses a missing folder or one with no model draft for the chosen datasets (`USAGE`). The `model` factory gets the dataset id for this. The real-data tier does the same. The smoke suite is coffee_roaster-v1, saas-v2 and restaurant-v3; the full suite is all 30 datasets.
- **Token usage (M14a).** `routeSummary(calls)` records each route's `inputTokens`/`outputTokens` from the call records (the providers' `usage`; a cached call counts 0), `mergeRoutes` sums them (unknown when a part has none), and `runUsage(routes)` gives the result's `usage`: tokens in and out, calls, cached calls. Calls with no token count are counted in `unknownTokens`, and a call is failed at status 0 or ≥ 400 (`failedCall`, as in `aa usage`). `usageLine(usage)` is its RESULTS.md line; a result written before M14a reads "Usage: n/a", and a run with no provider calls (the baseline) "Usage: no provider calls (scripted model)" (docs/EVALS.md §3).
- `scoreReport(report, key, run)`, `subjectOf`, `matchesPlanted`, `matchesDistractor`, `sliceOf`, `summarize(scores)`: the bars.
- `evalCommand(args, deps)` (typed `EvalRunError`), `resultsPage(dir)`, `resultsMarkdown(result)`. Full-suite results are committed in `evals/results/`; smoke runs stay local.
- `EvalArgs.label` / `note` / `only` (`aa eval --label --note --only`):
  - **Label.** It names the model row and, through `evalSlug(date, args)`, the file. A label is lower-cased with every other run of characters turned into "-", so `vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ` becomes `<date>-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json`. A plain `--model` keeps its old file name.
  - **Only.** `selectDatasets(suite, only)` picks the datasets and refuses an id outside the suite (`UNKNOWN_DATASET`).
  - **Name.** `EvalArgs.name` names the row when no label is given without changing the file name. The CLI sets it for `--model configured` to `configuredName(models)`, the configured routes (e.g. `openai-compatible:groq:qwen/qwen3.8-27b planner, gpt-oss-120b extractor, gpt-oss-20b judge`), so a nightly run's row says what served it and its file stays `<date>-configured[-small]-<suite>.json`.
  - **Passes.** `EvalArgs.passes` (`aa eval --passes 2`, used by scripts/eval-daily.sh) carries a run over up to that many passes. `planResume(prev, { suite, modelName, ids, passes, today })` reads the row's latest file: while it has unfinished jobs and a pass left, the same model per role (`roleModels`, checked before any call), and its last pass was the day before, the pass runs only those jobs, and `resumeResult` joins them with the earlier finished scores (kept as scored; bars recomputed). The combined file replaces the earlier one, and `SuiteResult.passes` records `{ dates, of }`. `runStatus(done, total, passes)` is `complete`, `resuming` (unfinished, a pass left: "n/a (resumes next pass)", README "in progress") or `partial` (unfinished after the last pass). The CLI prints a `combined:` line for the whole run. Otherwise the pass starts again: a same-day rerun does not use up a pass, and an earlier result still waiting for a pass (skipped night, model change) is returned as `close` and written back closed, so it reads partial. `readPrevious(path)` validates the earlier file; one that isn't a suite result (`BAD_RESULTS`) is renamed `<file>.bad` and the night starts again. `--passes` refuses `--only`.
  - **Merging.** `mergeResults(parts, { suite, modelName, note?, order })` joins runs over parts of a suite into one `SuiteResult`: suite order, real timings, bars recomputed. It refuses a missing or repeated dataset, runs of another suite, and runs whose role was served by a different model (a fallback provider of the same model is fine). The merged `seconds` is the sum of the per-dataset times, not the wall time across sessions. `mergeChunks` adds the script's checks: `--suite` is smoke or full, and every chunk ran in the mode `--small-model` says. `bun run eval:merge` (scripts/merge.ts) writes it to `evals/results` and rebuilds RESULTS.md. The Kaggle notebook (evals/README.md) uses all three.
- Real-data tier (evals/real/README.md): `runRealSuite({ model, modelName, embedder, dataDir, answersDir })`, `scoreCheck(check, report)`, `scoreRealReport`, `loadRealAnswers`, `missingRealData`, `realEvalCommand(args, deps)` (`NO_DATA` when a file has not been fetched) and `realResultsMarkdown(result)`. `resultsPage` adds the "Real public data" section from `*-real.json` results.
- Your own data (`aa eval --suite real --answers <dir> [--data <dir>]`): an answer file whose `dataset` is not one of the public `REAL_DATASETS` must carry a `title`, or `runRealSuite` throws `UNKNOWN_DATASET` (so a typo in a public id still fails). Its result (`RealDatasetResult`) has `own: true`, the title from the answer file, empty publisher, licence and citation, and the SHA-256 of the file actually read; `realResultsMarkdown` heads such a run "your data" instead of "real public data". The worked example is `examples/my-evals/coffee-roaster.yaml`.

## Example

```bash
bun run eval -- --suite full --model baseline                 # one command, offline
bun run eval -- --suite full --model ollama:qwen3.5:9b        # a local model (every role)
bun run eval -- --suite full --model configured               # the models in .env / config
bun run eval -- --suite full --model configured --small-model --passes 2   # nightly: a quota-cut night resumes the next
bun run eval:real:fetch && bun run eval:real                 # public datasets (evals/real), offline baseline
# one business per run (e.g. to fit a session limit), then one published row:
bun run eval -- --suite full --model configured --only saas-v2 --results-dir data/chunks/saas-v2
bun run eval:merge -- --label "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ" data/chunks/*/*-full.json
```

`EvalArgs.resultsPage` sets where the RESULTS.md page is written. It defaults to beside the results folder (`evals/RESULTS.md` in a checkout); `aa eval --results-dir dir` and the standalone binary put it inside the results folder instead, never in the user's working directory.
