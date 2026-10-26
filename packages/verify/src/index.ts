// Public API of @agentic-analytics/verify: passes V1–V8 and the failure policy (agent-and-verifier §7).
export { isCausal, rewriteCorrelational } from "./causal.ts";
export { dataNames, parseMeasured } from "./labels.ts";
export { type Recomputed, recomputeFacts, same, TOLERANCE, VerifyError } from "./recompute.ts";
export {
  type CheckRow,
  checkFactRows,
  NEUTRAL_TITLE,
  persistChecks,
  type VerifyContext,
  type VerifyResult,
  verifyReport,
} from "./verify.ts";
