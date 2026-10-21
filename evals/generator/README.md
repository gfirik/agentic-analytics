# @agentic-analytics/eval-generator

The seeded dataset generator (docs/EVALS.md §1). It produces 10 archetypes × 3 variants = 30 synthetic businesses. Each has realistic monthly transactions, documents that mention what happened, and an answer key.

| Variant | Months | Files | Planted |
|---|---|---|---|
| v1 | 12 | `sales.xlsx` (Orders + Costs), dd/mm/yyyy text dates | P1 key client lost after a price rise · Q1 ×1000 cost typo · Q2 date ambiguity · D1 noise blip |
| v2 | 18 | `orders.csv` + `costs.xlsx` | P1 · P2 refund rate rises after a supplier switch · Q1 · D1 |
| v3 | 24 | `sales.xlsx`, a December peak | P1 · P3 a new product cannibalizes an old one · Q1 · D1 · D2 seasonal peak |

The D1 blip (3% on one counter customer) sits in 2025-12 in v1 and v2, and in 2026-01 in v3, so it never lands on v3's planted December peak (code-quality fix 11b; until then v3's D1 shared 2025-12 with D2, and RESULTS.md v3 scores before that change used the old data).

Every dataset also has the cause documents (the key client's email, a price notice, ops notes, a launch plan) and distractor documents: a coincidental event and an irrelevant policy.

Everything comes from integer cents and a seeded PRNG, so the files are byte-identical on every build. `manifest.json` pins a SHA-256 per file, and the test fails on drift. Answer keys are versioned in `evals/datasets/generated/<id>/answers.yaml`. The files themselves are gitignored and rebuilt on demand.

## Public API

- `ARCHETYPES`, `generateDataset(archetype, variant, seed?)`, `generatedDatasets()`: datasets as `{ id, answers, files }` in memory.
- `answersYaml(key)`, `manifest(datasets)`.
- Types: `AnswerKey`, `Planted` (`metric`, `period`, `member?`, `driver?`, `driver_alternatives?`, `persists?`, `cause?`, `good_actions`), `Distractor`, `QualityKey`.

## Example

```bash
bun run --filter @agentic-analytics/eval-generator build:datasets   # → evals/datasets/generated/<id>/{files,answers.yaml}
```
