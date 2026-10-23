// Public API of @agentic-analytics/eval-generator (docs/EVALS.md §1).
export { ARCHETYPES, type Archetype } from "./archetypes.ts";
export {
  type AnswerKey,
  answersYaml,
  type Dataset,
  type Distractor,
  GENERATOR_VERSION,
  generateDataset,
  generatedDatasets,
  type Member,
  manifest,
  type Planted,
  type QualityKey,
} from "./generate.ts";
export { type TableHeaders, tableHeaders } from "./headers.ts";
// The held-out generated set (docs/specs/accuracy.md §9): release runs and the smoke suite's held-out dataset only.
export { HELDOUT_ARCHETYPES, HELDOUT_GENERATOR_VERSION, HELDOUT_SMOKE, heldoutDatasets } from "./heldout.ts";
