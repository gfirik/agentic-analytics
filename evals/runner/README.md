# @agentic-analytics/eval-runner

The eval runner and scoring (docs/EVALS.md §2–§4). It runs each dataset as a full job, scores the report against the dataset's answer key, writes `evals/results/<date>-<model>-<suite>.json`, and regenerates `evals/RESULTS.md`.

## Scoring

- **Subject of a finding:** the change its first (code-written) claim states, read from fact labels: the metric, the member if any, and the "after" period. Matching never looks at wording, so a model can't score by writing the right words.
- **Planted event found:** a top-5 finding has the same metric (or a channel slice of it, e.g. `wholesale_revenue` for revenue) and the same member. Its period must be within ±1, or any later period when the event `persists` (a lost client also shows in a June-on-June drop).
- **Driver:** the top driver of any matching finding is the expected member or an accepted alternative (the key client's channel).
- **Cause:** a matching finding has a claim with grade ≥ the expected grade that cites the expected document.
- **Action:** the top recommendation is about the event, and its scenario type is one of `good_actions`.
- **Distractor reported:** any finding matches it exactly (same period).
- **Quality issue found:** a data-quality item of the same kind cites the same file.
- Number mismatches, citation precision, definition adherence and grounding come from the report's verification summary, or from a job that failed with `RECOMPUTE_MISMATCH`/`REDERIVE_MISMATCH`.

## Baseline model

`baselineModel()` is a scripted heuristic (FakeModel): a keyword extractor, a rule-based planner and a word-overlap judge, with no LLM. It lets the whole harness run end to end offline (the smoke suite in CI), and it is the floor that real models are compared with. RESULTS.md labels it as such.

## Public API

- `runSuite({ suite, model, modelName, embedder, smallModel?, datasets? })` and `suiteDatasets(suite)`. The smoke suite is coffee_roaster-v1, saas-v2 and restaurant-v3; the full suite is all 30 datasets.
- `scoreReport(report, key, run)`, `subjectOf`, `matches`, `summarize(scores)`: the bars.
- `evalCommand(args, deps)`, `resultsPage(dir)`, `resultsMarkdown(result)`.

## Example

```bash
bun run eval -- --suite full --model baseline                 # one command, offline
bun run eval -- --suite full --model ollama:qwen3.5:9b        # a local model (every role)
bun run eval -- --suite full --model configured               # the models in .env / config
```
