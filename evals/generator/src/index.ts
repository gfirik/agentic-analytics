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
