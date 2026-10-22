# Evals: how we prove it works

The eval suite is both our quality gate and our strongest launch material. Every claim in the README is backed by a number from here.

## 1. Datasets (`evals/datasets/`)

Each dataset is a **synthetic business**. It contains:

- files: spreadsheets with realistic mess, PDFs, emails;
- an `answers.yaml` describing what a correct report must find.

**Generator** (`evals/generator/`): a seeded TypeScript generator. It creates 12–36 months of transactions for a business archetype, then **plants** known events:

- a price change that loses a key client;
- a supplier switch that raises refunds;
- a seasonal peak;
- a data-entry error (×1000 typo);
- a new product cannibalizing an old one;
- a concentration risk;
- a Simpson's-paradox setup.

It also generates the documents that mention those events, plus **distractors**: random noise spikes inside the noise band, coincidental events with no effect, and irrelevant documents.

**Archetypes for v0.1:**

1. Coffee roaster (retail + wholesale)
2. Printing shop
3. Clinic (services)
4. Online store
5. Distributor (B2B)
6. Restaurant
7. SaaS-like subscriptions
8. Logistics
9. Construction supplier
10. Agency

There are at least 3 variants each with different seeds and planted events: **30+ datasets** in total. A reviewed synthetic subset was once planned here; the golden set is now the M14 question set over real datasets (docs/specs/accuracy.md).

**v0.1 generator (M11):** 10 archetypes × 3 variants = 30 generated datasets (evals/generator/README.md), plus the two hand-built ones (coffee-roaster-v1, printing-shop-v1). The planted events are a key client lost after a price rise (all variants), a supplier switch that raises refunds (v2), and a new product cannibalizing an old one (v3). Each dataset also has a ×1000 typo, date ambiguity (v1), a noise blip inside the band, a seasonal December peak (v3) as a distractor, and coincidental and irrelevant documents. The Simpson's-paradox and concentration-risk setups are not generated yet.

**`answers.yaml` example** (from `evals/datasets/generated/agency-v2`, shortened; the full shape is `AnswerKey` in evals/generator/src/generate.ts):

```yaml
dataset: agency-v2
period: { from: 2025-01, to: 2026-06, grain: month }
currency: EUR
today: 2026-07-01
planted:
  - id: P1
    type: regression
    metric: revenue
    period: 2026-04
    driver: { dimension: customer, member: Lumen Cosmetics }
    driver_alternatives: [{ dimension: channel, member: retainers }]
    persists: true
    cause: { doc: email-lumen-cosmetics.eml, grade_at_least: document_supported }
    good_actions: [recover_share]
    description: Lumen Cosmetics paused its standing order after the retainers price rise
distractors:
  - id: D1
    description: a 3% blip for Workshops, inside the noise band
    metric: revenue
    period: 2025-12
    member: { dimension: customer, member: Workshops }
    must_not_appear_as_finding: true
quality:
  - id: Q1
    kind: unit_error
    file: costs.xlsx
    location: costs.xlsx#Costs!D12
```

A key states no expected change size: a planted event matches on its metric, period, member and direction (evals/runner/README.md). `type` and `persists` are recorded for readers and are not scored; a quality key matches on its file and the sheet in `location` (its column only when a citation names cells).

## 2. Metrics

The golden question set, its scorer, the paired bootstrap and (as M14 builds them) repeated runs, the ablation and the held-out sets are specified in **docs/specs/accuracy.md**.

How a finding is matched to a planted event (by the subject its code-written first claim states, never by wording) is described in evals/runner/README.md.

| Metric | Definition | v0.1 bar |
|---|---|---|
| Number mismatches | Jobs aborted on a wrong number (V2 recompute, V3 re-derivation, or a fact citing rows that don't hold it). A shipped report never has one, so this counts aborted jobs | 0 |
| Planted recall@k | Share of planted events present among top-k findings (k = 5) with the correct driver, moving the event's way (a regression lowers revenue, raises a refund rate) | ≥ 80% (reference model) |
| Driver accuracy | Correct top driver for detected planted events | ≥ 90% |
| Cause grade accuracy | Assigned causal grade ≥ expected | ≥ 80% |
| Distractor FP rate | Distractors reported as findings (a one-member blip also counts when reported on the whole metric at that period) | ≤ 10% |
| Quality-issue recall | Planted data-quality issues reported with the right kind, file and sheet (and column when the citation names cells; the engine's items cite rows) | ≥ 90% |
| Citation precision | Quotes the verifier's judge found supporting, of those it checked (V5). Measured in the pipeline by the judge under test, before drops; claims it rejected don't ship. No quote checked is a fail, not a pass. A separate post-ship judge is planned for the golden set (M14) | ≥ 95% |
| Definition adherence | Completed jobs with no claim dropped for breaking a confirmed definition (V6). Measured in the pipeline, like citation precision; no completed job is a fail | 100% |
| Recommendation grounding | Recs with ≥ 1 verified finding | 100% |
| Recommendation relevance | Top rec matches a `good_actions` category | ≥ 70% |
| Retrieval recall@8 | Answer-bearing chunk in the top 8 | ≥ 0.85 |
| Injection suite | Pass rate (see specs/security.md §8) | 100% |
| Cost / time | Tokens and wall time per job, per model | reported |

## 3. Suites

- **`unit`** (CI, every push): analysis math, parsers and schema. No models.
- **`smoke`** (CI, every PR): 3 datasets end-to-end with the `baseline` scripted FakeModel (`evals/runner/test/smoke.test.ts`). This checks the plumbing and the model-independent invariants. The verifier failure policy and the injection suite have their own tests in the same CI run.
- **`full`** (manual, local or free endpoint): all datasets with a real model. Command: `aa eval --suite full --model <provider:model>` (or `--model baseline` offline, `--model configured` for the .env models). Writes `evals/results/<date>-<model>-<suite>.json` and regenerates `evals/RESULTS.md`. It exits 1 when any bar fails.
  - **Label and note.** `--label "<name>"` names the run's model row in RESULTS.md and the README table, and its file (`<date>-<label slug>-<suite>.json`). This keeps a self-hosted run apart from other runs of `configured`. `--note "<text>"` adds a note above its table, for hardware and caveats.
  - **Passes.** `--passes <n>` carries a run over up to n passes (the nightly run uses 2, §4). A pass resumes the row's latest result when it has unfinished jobs and a pass left, was served by the same model per role (checked before any quota is spent), and its last pass was the day before: it runs only the unfinished jobs and writes the combined result in place of the earlier file. Otherwise it starts a new run: a same-day rerun starts again instead of using up a pass, and an earlier result still waiting for a pass that won't come (a skipped night, a model change) is rewritten closed, so it reads partial. An earlier file that isn't a valid results file is set aside as `<file>.bad`. A `configured` run without a label is named after its routes (planner, extractor, judge), and its file keeps the `configured` name.
  - **Chunks.** `--only <id,…>` runs some datasets of the suite and needs a `--results-dir` outside the checkout's `evals/results`, so a chunk never becomes a published row. `bun run eval:merge -- --label "<name>" <part.json>…` joins the chunks into one results file in `evals/results`, with their real timings and the bars recomputed over all of them. Every dataset of the suite must be present exactly once.
  - **Kaggle.** `evals/kaggle/full-suite-vllm.ipynb` runs the full suite this way on Kaggle's free 2×T4 GPUs, with Qwen3.8-27B (4-bit) served by vLLM inside the notebook. One business per run, resumable across sessions; steps in evals/README.md.
  - **Publishing.** `bun run readme:assets` rebuilds RESULTS.md and the README table from `evals/results/*.json`.
  - **Token usage (M14a).** Each route in a results file records the tokens its calls spent (`inputTokens`, `outputTokens`, from the providers' `usage` field, a cached call at 0), and the result's `usage` holds the run's totals: tokens in and out, calls and cached calls. RESULTS.md prints them as a "Usage:" line per run, with calls that had no token count listed as such (as `aa usage` lists them); results written before M14a read "Usage: n/a", and a run with no provider calls (the scripted baseline) reads "Usage: no provider calls (scripted model)". A run merged from passes or chunks has `usage` only when every part recorded tokens. The older `tokens` field is the model client's own sum, which also counts a cached answer's original usage, so it is not the quota spent. `aa usage` shows the same counts per UTC day from `data/logs/model-calls.jsonl`, against each route's daily limit (docs/specs/models.md §5).
- **`real`** (manual, offline with `--model baseline`): public datasets as published, with their real mess (evals/real/README.md). `bun run eval:real:fetch` downloads each file and verifies its SHA-256 (data is never committed; licences and credits in evals/real/DATASETS.md); `bun run eval:real` (`aa eval --suite real`) runs the engine and scores each report against `evals/real/answers/<dataset>.yaml`. Checks read only report.json: the job completes, every number verifies, the expected data-quality kinds are reported for the right columns, a known seasonal peak is the top month and its values equal SQL, and part-months or regular seasonal moves are not reported as news. Every expected number comes from SQL written in the answer file. Results go to `evals/results/<date>-<model>-real.json` and the "Real public data" section of RESULTS.md; failed checks are engine gaps, recorded in STATE.md, and are never tuned away. CI runs the scoring tests and skips the re-run when the data hasn't been fetched.
- **Your own data** (M13g): `aa eval --suite real --answers <dir> [--data <dir>]` runs the same tier on your files: one answer file per dataset in `<dir>`, with a `title` (an answer file whose dataset is not a public one needs it; a typo in a public id still fails as `UNKNOWN_DATASET`). `--data` defaults to the answers folder. Results go to `./eval-results` (or `--results-dir`), never to `evals/results`. A worked example for the example workbook: `examples/my-evals/coffee-roaster.yaml`.
- **External** (P1): subsets of DABstep and DDR-Bench, for credibility in the docs.

## 4. Publishing

`evals/RESULTS.md` holds the latest table per model: free hosted models, local Ollama models and self-hosted vLLM runs (e.g. the Kaggle notebook's `vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ`), each with its hardware noted. The docs site renders it.

Models are listed honestly. A weak result is shown, not hidden, and small-model mode is noted.

A run whose jobs didn't all finish (a free tier's daily quota ran out) is published as **partial**. The README row reads "partial: k of n jobs finished", and RESULTS.md judges no bar on it ("n/a (partial run)"); the aggregate rates count every unfinished job as a miss, so they are not the model's quality. A run carried over passes (`--passes`) is partial only when jobs are still unfinished after its last pass: a job that a later pass finished counts as finished. Between passes it reads "in progress: k of n jobs finished, the next pass runs the rest" in the README and "n/a (resumes next pass)" in RESULTS.md.

**Free tiers with daily quotas.** Run one pass a day, after the quota resets: `bash scripts/eval-daily.sh full --small-model --keep-reports data/eval-reports` (for example from cron). One night's quota does not cover the full suite: on 2026-10-19 Groq's 200k tokens/day for the planner (`qwen/qwen3.8-27b`) ran out after 21 of the 30 businesses (about 9k planner tokens each), and the other 9 failed `RATE_LIMITED`. So every run takes up to two nights (`--passes 2`): the first night runs every business, and the second runs only the ones the quota stopped, then publishes one combined result. Two nights' quota covers about 42 businesses. Each pass:
- replays every finished call from `evals/.cache` (a cached answer is served even while the route is rate-limited);
- spends the day's quota on the businesses not yet finished (on the second night, only the first night's unfinished ones);
- regenerates the README table and RESULTS.md;
- on the second night, deletes the first night's results file, which the combined file replaces. If that file was committed, the deletion shows in `git status` of the checkout and goes in the same PR as the combined file. So commit a first night's file only together with its second night: on its own it reads "in progress" until a later run closes it;
- refuses a rerun on the day of a run's last pass (it would overwrite the combined file), and sets an unreadable earlier file aside as `<file>.bad` (gitignored);
- sends a one-line summary through `scripts/notify.sh`. The log is one file per UTC day (`data/logs/eval-<suite>-<date>.log`), appended to; the summary counts only this run's part of it, so a same-day rerun doesn't add the earlier run's jobs.

To see where the quota stands now: `aa usage` (its first section is the last 24 hours, with Groq's own count from its latest rate-limit error). To see what a night used: `aa usage --day <YYYY-MM-DD>` (UTC). On 2026-10-19 the planner route spent 188,852 tokens of Groq's 200,000 (94.4%).

It never switches models. A second route for the same model adds quota on the first night. For the planner, Cloudflare Workers AI serves `@cf/qwen/qwen3.8-27b` on its free plan: 10,000 neurons a day with no card, and calls past that fail rather than bill (developers.cloudflare.com/workers-ai/platform/pricing). At 40,909 neurons per M input tokens and 290,909 per M output, that is about 16 businesses a day: `PLANNER_MODEL=openai-compatible:groq:qwen/qwen3.8-27b|openai-compatible:cloudflare:@cf/qwen/qwen3.8-27b`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set. Cerebras serves the model as `qwen-3.8-27b`, but only on a $5, 30-day trial that needs a payment method, so it is not a free route. OpenRouter lists no free (`:free`) variant.

**Replaying a real run's metrics, offline.** `aa eval --suite full --model baseline --small-model --replay-drafts data/eval-reports --results-dir <scratch dir>` answers each business's metric-draft request with the drafts a real model wrote on a kept nightly run (`<dataset>.metrics.drafted.json`, kept by `--keep-reports`). Detection, ranking and the findings cap then run on those metrics, and the scripted baseline plays the other roles. The run is deterministic and spends no quota, so a ranking change can be measured against real drafted metrics before a nightly run.
- It needs a `--results-dir` outside `evals/results`: its metrics are a model's and its other roles scripted, so it is neither the baseline row nor that model's row.
- A missing folder, or one with no model draft for the chosen datasets, is refused.
- On the 2026-10-20 run's kept drafts it gives P1 30/30, P2 4/10 and P3 0/10 with the code that run used. The run itself found P1 29/29, P2 4/10 and P3 0/9 on its finished jobs. The M14a ranking fix brings the replay to 92%.
- It doesn't replace the nightly run: the explain, decide and draft roles stay scripted, so causes and recommendations are the baseline's.

## 5. Rules

- Datasets and answer keys are versioned. Changing an answer key requires a note in the PR.
- No tuning prompts on the golden set without re-running the full suite.
- A regression of any bar blocks release.
