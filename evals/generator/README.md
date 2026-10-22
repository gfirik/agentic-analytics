# @agentic-analytics/eval-generator

The seeded dataset generator (docs/EVALS.md §1). It produces 10 archetypes × 3 variants = 30 synthetic businesses. Each has realistic monthly transactions, documents that mention what happened, and an answer key.

| Variant | Months | Files | Planted |
|---|---|---|---|
| v1 | 12 | `sales.xlsx` (Orders + Costs), dd/mm/yyyy text dates | P1 key client lost after a price rise · Q1 ×1000 cost typo · Q2 date ambiguity · D1 noise blip |
| v2 | 18 | `orders.csv` + `costs.xlsx` | P1 · P2 refund rate rises after a supplier switch · Q1 · D1 |
| v3 | 24 | `sales.xlsx`, a December peak | P1 · P3 a new product cannibalizes an old one · Q1 · D1 · D2 seasonal peak |

The D1 blip (3% on one counter customer) sits in 2025-12 in v1 and v2, and in 2025-11 in v3, so it never lands on v3's planted December peak or the drop after it (code-quality fix 11b; until then v3's D1 shared 2025-12 with D2, and RESULTS.md v3 scores before that change used the old data).

Every dataset also has the cause documents (the key client's email, a price notice, ops notes, a launch plan) and distractor documents: a coincidental event and an irrelevant policy.

Everything comes from integer cents and a seeded PRNG, so the files are byte-identical on every build. `manifest.json` pins a SHA-256 per file, and the test fails on drift. Answer keys are versioned in `evals/datasets/generated/<id>/answers.yaml`. The files themselves are gitignored and rebuilt on demand.

## Held-out set

`heldoutDatasets()` (src/heldout.ts) builds the held-out generated set (docs/specs/accuracy.md §9): the 10 archetypes once more with new seeds (`<archetype>-v<k>-heldout`), and two archetypes no heuristic was written against, `tool_hire` and `car_wash`, in two variants each: 14 datasets. Their keys are in `evals/datasets/heldout/<id>/answers.yaml` (`split: heldout`, `generator_version: 2`) and their hashes in `heldout-manifest.json`. Only release runs (`aa eval --suite heldout`) and the smoke suite's one held-out dataset (`HELDOUT_SMOKE`) read them; nothing under packages/ or apps/ may name this API (evals/runner/test/heldout-guard.test.ts). `test/heldout.test.ts` also proves the 30 are unchanged: it pins the digests of their manifest and answer keys from before the set existed, computed after generating the held-out set in the same process (SheetJS keeps a global number-format table, so the held-out workbooks use Excel's built-in date format).

## Public API

- `ARCHETYPES`, `generateDataset(archetype, variant, seed?)`, `generatedDatasets()`: datasets as `{ id, answers, files }` in memory.
- `answersYaml(key)`, `manifest(datasets)`.
- `heldoutDatasets()`, `HELDOUT_ARCHETYPES`, `HELDOUT_SMOKE`, `HELDOUT_GENERATOR_VERSION`: the held-out set (release runs and the smoke suite only).
- Types: `AnswerKey` (with `split?: "heldout"`), `Planted` (`metric`, `period`, `member?`, `driver?`, `driver_alternatives?`, `persists?`, `cause?`, `good_actions`), `Distractor`, `QualityKey`.

## Example

```bash
bun run --filter @agentic-analytics/eval-generator build:datasets   # → evals/datasets/generated/<id>/{files,answers.yaml}
bun run --filter @agentic-analytics/eval-generator build:heldout    # → evals/datasets/heldout/<id>/{files,answers.yaml}
```
