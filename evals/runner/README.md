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

- `runSuite({ suite, model, modelName, embedder, smallModel?, datasets? })` and `suiteDatasets(suite)`. The smoke suite is coffee_roaster-v1, saas-v2 and restaurant-v3; the full suite is all 30 datasets.
- `scoreReport(report, key, run)`, `subjectOf`, `matchesPlanted`, `matchesDistractor`, `sliceOf`, `summarize(scores)`: the bars.
- `evalCommand(args, deps)` (typed `EvalRunError`), `resultsPage(dir)`, `resultsMarkdown(result)`. Full-suite results are committed in `evals/results/`; smoke runs stay local.
- Real-data tier (evals/real/README.md): `runRealSuite({ model, modelName, embedder, dataDir, answersDir })`, `scoreCheck(check, report)`, `scoreRealReport`, `loadRealAnswers`, `missingRealData`, `realEvalCommand(args, deps)` (`NO_DATA` when a file has not been fetched) and `realResultsMarkdown(result)`. `resultsPage` adds the "Real public data" section from `*-real.json` results.

## Example

```bash
bun run eval -- --suite full --model baseline                 # one command, offline
bun run eval -- --suite full --model ollama:qwen3.5:9b        # a local model (every role)
bun run eval -- --suite full --model configured               # the models in .env / config
bun run eval:real:fetch && bun run eval:real                 # public datasets (evals/real), offline baseline
```

`EvalArgs.resultsPage` sets where the RESULTS.md page is written. It defaults to beside the results folder (`evals/RESULTS.md` in a checkout); `aa eval --results-dir dir` and the standalone binary put it inside the results folder instead, never in the user's working directory.
