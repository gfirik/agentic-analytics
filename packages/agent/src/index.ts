// Public API of @agentic-analytics/agent (docs/specs/agent-and-verifier.md §2–§9).
export {
  contributionDrivers,
  decompositionClaims,
  findingType,
  LOWER_IS_BETTER,
  label,
  observedClaim,
  periodOf,
  q,
  severity,
} from "./claims.ts";
export { type DecideInput, DecideOutput, decide } from "./decide.ts";
export { buildDraft, type DraftInput, reportQuestion } from "./draft.ts";
export {
  type Downgraded,
  type Dropped,
  type ExplainOptions,
  ExplainOutput,
  type ExplainResult,
  explainFindings,
  SmallExplainOutput,
} from "./explain.ts";
export { type Extract, ExtractOutput, type ExtractResult, extractFromHits, readExtracts, screen } from "./extractor.ts";
export { buildFactSheet, type FactSheet, type SheetFact, sheetFact } from "./factsheet.ts";
export { PromptError, type PromptName, promptVersion, renderPrompt } from "./prompts.ts";
export { writeHeadline } from "./summary.ts";
export { Budget, buildTools, type OpenQuestionDraft, type ToolContext } from "./tools.ts";
