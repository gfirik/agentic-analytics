# Spec: agent (`packages/agent`) and verifier (`packages/verify`)

## 1. Model roles

| Role | Job | Default tier |
|---|---|---|
| `extractor` | Reads untrusted text (chunks, emails, web pages) and returns typed extracts only. Has no tools. | small/fast |
| `planner` | Plans investigations, explains drivers, drafts findings and recommendations from the fact sheet and extracts | strongest available |
| `judge` | Yes/no entailment checks for the verifier | small/fast |
| `embedder` | Embeddings | `bge-m3` |

Roles map to models in config (see specs/models.md). One model may serve every role.

## 2. Fact sheet

After DECOMPOSE, `agent/factsheet.ts` builds the planner's only numeric input, a compact JSON with:

- the objective;
- metric definitions (with assumption flags);
- the ranked material insights;
- decompositions;
- quality issues.

Each item has a fact ID (`N…`), a value with its unit, and a short label. The planner never sees raw tables.

## 3. Tools available to the planner

The planner has fixed tools only; there is no code execution.

| Tool | Does |
|---|---|
| `get_facts(ids \| query)` | Look up computed facts |
| `drill_down(metric_id, period, dimension, filters?)` | Runs a **pre-defined** analysis template on a slice and returns new facts. It cannot run arbitrary SQL. |
| `decompose(fact_id, method)` | Runs a decomposer on a material change |
| `search_documents(query, filters?)` | Retrieval lane, returning extracts (not raw text) |
| `search_web(query)` | Web lane, only when enabled, returning external extracts |
| `propose_scenario(type, params, because[])` | Computes an impact range in code (analysis-library §5) |
| `ask_user(question)` | Adds an open question (non-blocking in v0.1) |

Investigation budget: at most 25 tool calls and 8 per finding, both configurable. Small-model mode halves these.

## 4. Web lane rules

- **Off by default.** Turn it on with `--web` or `options.web = true`.
- **Query sanitizer.** Before a query goes to `search_web`, the sanitizer strips:
  - numbers taken from the user's data;
  - customer, supplier and person names from the entities table;
  - emails, phones, and anything flagged private.
  Only industry, product category, region, period and public terms remain, e.g. "specialty coffee wholesale price increase 2026 Central Asia".
- **Processing.** Fetched pages go to the extractor, and the extracts are stored with `external = true`.
- **External facts.** Numbers from the web become facts with `computation.kind = "function"`, `fn = "external_quote"`. They can only feed `benchmark_gap.v1` and must be rendered with the External badge.

## 5. EXPLAIN

For each top finding, the planner:

1. states the observed change, using fact placeholders;
2. lists candidate explanations;
3. checks each one with tools: drill-down, decomposition, document search, web;
4. assigns each explanation a causal grade.

**Causal grades** (enforced by the verifier):

| Grade | When |
|---|---|
| `observed` | the decomposition itself, e.g. "wholesale accounts for 108% of the drop" |
| `correlated` | timing coincides with an event |
| `document_supported` | a source document explicitly links the event and the effect, e.g. an email saying the order was paused because of the price |
| `intervention_supported` | a dated intervention plus a before/after change past the noise band in the affected segment only |

The planner must also record **alternatives considered and rejected**, with the reason. These appear in the report's confidence reasons.

## 6. DECIDE

1. Generate 3–6 candidate actions linked to findings.
2. Score each by objective impact (from `propose_scenario`), effort, risk and confidence.
3. Keep the top 2–5.
4. For each, set:
   - the `check` (metric, threshold, date);
   - `not_advised` when there is a tempting wrong move, e.g. "Don't cut retail prices; retail is growing".

Any recommendation without at least one verified finding is invalid.

## 7. Verifier passes (`packages/verify`)

All passes run on the draft report. Results are written to the `verification` table and summary.

| Pass | Check | Type |
|---|---|---|
| V1 placeholders | No free numerals in model-written text except dates, IDs and exact quotes | deterministic |
| V2 recompute | Re-run every fact's SQL/function; must match exactly (relative tolerance 1e-9) | deterministic |
| V3 re-derive | Headline facts (summary and finding facts) recomputed via an **alternate code path**, e.g. summing members vs total, or a row-level scan in TS vs SQL aggregate | deterministic |
| V4 definitions | Each fact's metric, unit, currency, period and filters match the metric definition used; the claim wording names that metric | deterministic + lexicon |
| V5 citations | The quote exists at its span; cited rows contain the fact's inputs; the judge model answers "does this source support this claim?" (yes/no) | deterministic + judge |
| V6 causal language | A causal lexicon (EN/RU/UZ: caused, due to, because of, led to, из-за, привело к, sababli…) requires grade ≥ `document_supported`; otherwise the claim is rewritten to correlational wording or downgraded | lexicon + rewrite |
| V7 grounding | Every recommendation cites verified findings; impact facts exist; check date is in the future; every finding has at least one verified claim | deterministic |
| V8 external | Every web-derived claim cites an external source and is rendered as external | deterministic |

**Failure policy:**

- **Drop:** a claim that fails V1, V4, V5 or V8.
- **Rewrite or downgrade:** a claim that fails V6.
- **Cascade:**
  - A finding left with no claims is dropped.
  - A recommendation that loses its grounding is dropped.
  - Every drop and downgrade is listed in `verification.claims_dropped` / `claims_downgraded`.
- **V2/V3 mismatches** are engine bugs. The job fails loudly with a diagnostic bundle instead of shipping a report.

## 8. Small-model mode

Selected automatically from the model profile, or with `--small-model`:

- tool budgets are halved;
- findings are capped at 3 and recommendations at 2;
- the explanation template is stricter, a fill-in-the-blanks structured output;
- web is off unless explicitly enabled.

The engine stays fully correct in this mode because all numbers and decompositions are deterministic.

## 9. Prompts

- Prompts live in `packages/agent/prompts/*.md` with typed variables. They are versioned and covered by snapshot tests.
- Each prompt states the facts-only rule and the placeholder rule, and includes a worked example from the coffee-roaster fixture.
