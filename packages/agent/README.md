# @agentic-analytics/agent

EXPLAIN and DECIDE.
- **Planner input:** the planner reasons over the fact sheet (computed facts only) and extracts from the quarantined extractor.
- **Tools:** it acts through fixed tools.
- **Placeholders:** everything it writes carries numbers only as `{{N…}}` fact placeholders.

- **Spec:** docs/specs/agent-and-verifier.md §1–§6, §8–§9; docs/specs/security.md §3
- **Status:** built in M7.

## Public API

- **`buildFactSheet(...)`**: the planner's only numeric input. It holds the objective, metrics (with assumption flags), the ranked insights, decompositions and quality issues. Every value is a fact.
- **`extractFromHits(ws, model, hits, task)`**: the quarantined extractor.
  - Output is validated by a strict schema.
  - Quotes must be exact substrings of the excerpt.
  - Suspicious text, flagged by the model or by `screen()`, is stored, flagged and excluded.
- **`buildTools(ctx, budget)`**: `get_facts`, `drill_down`, `decompose`, `search_documents`, `search_web` (off), `propose_scenario` and `ask_user`.
  - `Budget` allows 25 calls per job and 8 per finding by default.
- **`explainFindings(...)`**:
  - Code states the observed change and its decomposition (`observedClaim`, `decompositionClaims`).
  - The planner investigates, then writes explanations with causal grades and rejected alternatives.
  - Unknown fact or extract ids are dropped, and causal grades without a document are downgraded.
  - In small-model mode, a code-run search and a fill-in form replace this.
- **`decide(...)`**:
  - The planner proposes candidate actions and code computes each impact range (`scenarioFacts`).
  - Candidates are ranked by impact × confidence ÷ effort, and the top 2–5 are kept.
  - Ungrounded or invalid candidates are dropped.
- **`writeHeadline`, `buildDraft`**: the headline and the report v1 draft.
  - Every fact referenced is included, with its inputs.
  - Quality issues and open questions are worded without numerals.
- **`renderPrompt(name, vars)`**: prompts live in `prompts/*.md` with a versioned header and `[[variable]]` slots. They are covered by snapshot tests.

## Example

See `packages/core/src/job.ts`, which wires these into the EXPLAIN and DECIDE stages, and `packages/core/testing/coffee-planner.ts` for a scripted planner.
