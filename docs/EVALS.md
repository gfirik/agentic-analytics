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

There are at least 3 variants each with different seeds and planted events: **30+ datasets** in total. The golden set (hand-reviewed) is 10 of them.

**v0.1 generator (M11):** 10 archetypes × 3 variants = 30 generated datasets (evals/generator/README.md), plus the two hand-built ones (coffee-roaster-v1, printing-shop-v1). The planted events are a key client lost after a price rise (all variants), a supplier switch that raises refunds (v2), and a new product cannibalizing an old one (v3). Each dataset also has a ×1000 typo, date ambiguity (v1), a noise blip inside the band, a seasonal December peak (v3) as a distractor, and coincidental and irrelevant documents. The Simpson's-paradox and concentration-risk setups are not generated yet.

**`answers.yaml` example:**

```yaml
planted:
  - id: P1
    type: regression
    metric: revenue
    period: 2026-04
    expected_change_pct: -17.9
    tolerance_pct: 0.1
    driver: { dimension: channel, member: wholesale, min_share: 1.0 }
    cause: { doc: email-0412.eml, grade_at_least: document_supported }
    good_actions: [volume_discount_key_client, renegotiate_price]
distractors:
  - id: D1
    description: "March spike within noise band"
    must_not_appear_as_finding: true
quality:
  - id: Q1
    kind: unit_error
    location: "sales.xlsx#Monthly!D17"
```

## 2. Metrics

How a finding is matched to a planted event (by the subject its code-written first claim states, never by wording) is described in evals/runner/README.md.

| Metric | Definition | v0.1 bar |
|---|---|---|
| Number mismatches | V2/V3 failures in shipped reports | 0 |
| Planted recall@k | Share of planted events present among top-k findings (k = 5) with the correct driver | ≥ 80% (reference model) |
| Driver accuracy | Correct top driver for detected planted events | ≥ 90% |
| Cause grade accuracy | Assigned causal grade ≥ expected | ≥ 80% |
| Distractor FP rate | Distractors reported as findings | ≤ 10% |
| Quality-issue recall | Planted data-quality issues reported | ≥ 90% |
| Citation precision | Citations judged supporting (by a separate judge and spot-checked by hand on the golden set) | ≥ 95% |
| Definition adherence | Facts matching confirmed definitions | 100% |
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
  - **Chunks.** `--only <id,…>` runs some datasets of the suite and needs a `--results-dir` other than the checkout's `evals/results`, so a chunk never becomes a published row. `bun run eval:merge -- --label "<name>" <part.json>…` joins the chunks into one results file in `evals/results`, with their real timings and the bars recomputed over all of them. Every dataset of the suite must be present exactly once.
  - **Kaggle.** `evals/kaggle/full-suite-vllm.ipynb` runs the full suite this way on Kaggle's free 2×T4 GPUs, with Qwen3.8-27B (4-bit) served by vLLM inside the notebook. One business per run, resumable across sessions; steps in evals/README.md.
  - **Publishing.** `bun run readme:assets` rebuilds RESULTS.md and the README table from `evals/results/*.json`.
- **`real`** (manual, offline with `--model baseline`): public datasets as published, with their real mess (evals/real/README.md). `bun run eval:real:fetch` downloads each file and verifies its SHA-256 (data is never committed; licences and credits in evals/real/DATASETS.md); `bun run eval:real` (`aa eval --suite real`) runs the engine and scores each report against `evals/real/answers/<dataset>.yaml`. Checks read only report.json: the job completes, every number verifies, the expected data-quality kinds are reported for the right columns, a known seasonal peak is the top month and its values equal SQL, and part-months or regular seasonal moves are not reported as news. Every expected number comes from SQL written in the answer file. Results go to `evals/results/<date>-<model>-real.json` and the "Real public data" section of RESULTS.md; failed checks are engine gaps, recorded in STATE.md, and are never tuned away. CI runs the scoring tests and skips the re-run when the data hasn't been fetched.
- **Your own data** (M13g): `aa eval --suite real --answers <dir> [--data <dir>]` runs the same tier on your files: one answer file per dataset in `<dir>`, with a `title` (an answer file whose dataset is not a public one needs it; a typo in a public id still fails as `UNKNOWN_DATASET`). `--data` defaults to the answers folder. Results go to `./eval-results` (or `--results-dir`), never to `evals/results`. A worked example for the example workbook: `examples/my-evals/coffee-roaster.yaml`.
- **External** (P1): subsets of DABstep and DDR-Bench, for credibility in the docs.

## 4. Publishing

`evals/RESULTS.md` holds the latest table per model: free hosted models, local Ollama models and self-hosted vLLM runs (e.g. the Kaggle notebook's `vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ`), each with its hardware noted. The docs site renders it.

Models are listed honestly. A weak result is shown, not hidden, and small-model mode is noted.

## 5. Rules

- Datasets and answer keys are versioned. Changing an answer key requires a note in the PR.
- No tuning prompts on the golden set without re-running the full suite.
- A regression of any bar blocks release.
