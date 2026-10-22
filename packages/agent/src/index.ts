// Public API of @agentic-analytics/agent (docs/specs/agent-and-verifier.md §2–§9).

export { screenText } from "@agentic-analytics/schema";
export { type AskDraft, answerQuestion, reportClaims } from "./ask.ts";
export {
  type BudgetedRequest,
  type DecideFinding,
  fitToBudget,
  QUOTE_MAX_CHARS,
  SMALL_MODEL_INPUT_BUDGET,
  TOP_MEMBERS,
  TRIM_STEPS,
  type TrimStep,
  trimDecideInput,
} from "./budget.ts";
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
  topDrivers,
} from "./claims.ts";
export {
  bindIds,
  DecideAnswer,
  type DecideInput,
  DecideOutput,
  type DecideRequest,
  decide,
  decideRequest,
  repairCandidate,
} from "./decide.ts";
export { buildDraft, type DraftInput, reportQuestion } from "./draft.ts";
export { buildEvidence, MAX_EVIDENCE_ROWS } from "./evidence.ts";
export {
  CHANGE_EVENT_WORDS,
  type Downgraded,
  type Dropped,
  type ExplainOptions,
  ExplainOutput,
  type ExplainResult,
  explainFindings,
  RATE_EVENT_WORDS,
  relinkQuestions,
  SmallExplainOutput,
  smallModeQuery,
  withoutQuarantined,
} from "./explain.ts";
export {
  type Extract,
  ExtractOutput,
  type ExtractResult,
  extractFromHits,
  quarantine,
  quarantinedSources,
  readExtracts,
  screen,
} from "./extractor.ts";
export { buildFactSheet, type FactSheet, type SheetFact, sheetFact } from "./factsheet.ts";
export { data, PromptError, type PromptName, promptVersion, renderPrompt } from "./prompts.ts";
export { type ScreenSummary, screenDocuments, screenTables } from "./quarantine.ts";
export { writeHeadline } from "./summary.ts";
export { Budget, buildTools, type OpenQuestionDraft, type ToolContext } from "./tools.ts";
export { privateTerms, searchAndStore, type WebLane } from "./web.ts";
export { WITHHELD, withheld, withheldKeys, withheldMember } from "./withhold.ts";
