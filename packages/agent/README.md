# @agentic-analytics/agent

EXPLAIN and DECIDE.
- **Planner input:** the planner reasons over the fact sheet (computed facts only) and extracts from the quarantined extractor.
- **Tools:** it acts through fixed tools.
- **Placeholders:** everything it writes carries numbers only as `{{N…}}` fact placeholders.

- **Spec:** docs/specs/agent-and-verifier.md §1–§6, §8–§9; docs/specs/security.md §3
- **Status:** built in M7.

## Public API

- **`buildFactSheet(...)`**: the planner's only numeric input. It holds the objective, metrics (with assumption flags), the ranked insights, decompositions and quality issues, and with `sections` (M15) the scorecard rows, the concentration facts and the not-run entries. Every value is a fact. EXPLAIN shows each finding only its metric's scorecard row and, for a concentration or dependence finding, its dimension's facts (`findingSections`); DECIDE gets none of the sections, so its request fits small-model mode's budget.
- **`reportSections(sections, insightOf)`**, **`sectionFactIds`**: the report's `scorecard`, `concentration` (the dependence insight becomes its finding id) and `analyses_not_run`, and the facts they name, which the draft carries.
- **`businessModelAffects(model, findings, usesMetric, facts)`**: the findings the business model's assumption affects (semantics §4): wholesale the concentration findings over customers, retail average order value and units, subscription the customer counts.
- **`extractFromHits(ws, model, hits, task)`**: the quarantined extractor.
  - Output is validated by a strict schema.
  - Quotes must be exact substrings of the excerpt.
  - Suspicious text, flagged by the model or by `screen()`, is stored, flagged and excluded.
- **`answerQuestion(model, question, report)`**: follow-up answers as claims with placeholders. Each claim names the report claims it rests on (`F1#0`, `R2#1`), and code copies their citations and the weakest causal grade. The caller verifies the claims (`askJob` in core). Prompt `ask.md`.
- **`screen(text)` / `screenText(text)`**: the deterministic injection screen (security §3), defined in `@agentic-analytics/schema` and re-exported here; `_` reads as a space. Text is normalised first (NFKC, invisible characters, Latin accents, look-alike letters, spaced-out letters); EN/RU/UZ patterns.
- **`screenTables(ws)`, `screenDocuments(ws)`**: run the screen over table labels and text cells (after PROFILE) and over documents and emails (at INDEX_DOCS). Hits go to the `quarantine` table and are never sent to any model.
- **`buildTools(ctx, budget)`**: `get_facts`, `drill_down`, `concentration` (Pareto and top-N shares of an additive metric by one of its dimensions over a period range; refuses an unknown metric or dimension and periods that are not job periods), `decompose`, `search_documents` (its `from`/`to` take `YYYY-MM-DD`, `YYYY-MM`, `YYYY` or empty, via `normaliseDateFilter`; an unreadable date is a tool error for that call, not a schema failure), `search_web` (off), `compare_benchmark`, `propose_scenario` and `ask_user`.
  - `Budget` allows 25 calls per job and 8 per finding by default.
- **`explainFindings(...)`**:
  - Code states the observed change and its decomposition (`observedClaim`, `decompositionClaims`).
  - The planner investigates, then writes explanations with causal grades and rejected alternatives.
  - Unknown fact or extract ids are dropped, and causal grades without a document are downgraded.
  - In small-model mode, a code-run search and a fill-in form replace this. The search (`smallModeQuery`) names the metric, the top member of each contribution split (`topDrivers`, never "(other)"), the period and the change type's event words (`RATE_EVENT_WORDS` for a refund, return, defect or complaint rate; `CHANGE_EVENT_WORDS` otherwise).
- **`withheld`, `withheldMember`, `withheldKeys`** (`src/withhold.ts`): table text on its way into a planner prompt (fact labels, member values, decomposition keys, claims that quote a member). Text the injection screen flags is replaced; ids and values stay (security §3).
- **`decide(...)`**:
  - The answer is read per candidate (`DecideAnswer`, `repairCandidate`): one candidate breaking the output rules is dropped alone; `bindIds` binds the check's metric and file-named extracts when exactly one reading exists.
  - The planner proposes candidate actions and code computes each impact range (`scenarioFacts`).
  - Candidates are ranked by impact × confidence ÷ effort, and the top 2–5 are kept.
  - Ungrounded or invalid candidates are dropped.
  - With `maxInputTokens` (small-model mode: `SMALL_MODEL_INPUT_BUDGET`, 6,500), the request is trimmed to fit (§8.1). If it can't fit, nothing is sent (`INPUT_TOO_LARGE`) and DECIDE ships no recommendations, with the reason in `dropped`. The result reports `request: { estimate, untrimmed, steps }`.
- **`decideRequest(...)`, `trimDecideInput(sheet, findings, steps)`, `fitToBudget`, `TRIM_STEPS`**: the DECIDE request on its own, trimmed in the fixed `TRIM_STEPS` order until it fits.
  - Trimming is pure and deterministic. Kept values are never changed, and facts the findings cite are always kept.
  - Without a budget, the request is byte for byte the untrimmed one.
  - `test/fixtures/printing-shop-v1-decide.json` is a real request that a provider refused at 7,804 tokens.
- **`writeHeadline`, `buildDraft`**: the headline and the report v1 draft. With `semantics` (from the profile) the draft also carries `roles`, `table_kinds` and `business_model`, their measurements as SQL facts and the business model as an assumption; a quarantined table and a column whose name addresses a model are left out.
  - Every fact referenced is included, with its inputs.
  - Quality issues and open questions are worded without numerals.
- **`renderPrompt(name, vars)`**: prompts live in `prompts/*.md` with a versioned header and `[[variable]]` slots. They are covered by snapshot tests. The package reads them from `src/prompts.gen.ts`, generated from the `.md` files so they ship inside bundles and the standalone binary: after editing a prompt run `bun run prompts:write` (`bun run check` fails while it is stale).

## Example

See `packages/core/src/job.ts`, which wires these into the EXPLAIN and DECIDE stages, and `packages/core/testing/coffee-planner.ts` for a scripted planner.

**Quality items.** Issues of one kind in one column are grouped into one report item that cites the first rows and states its row count through a SQL count fact (`{{N…}} rows`, from `src/quality.sql.ts`; a `prefixed_id` count covers only the flagged prefixes), so the verifier re-runs it like any other number.
