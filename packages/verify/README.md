# @agentic-analytics/verify

The verifier runs passes V1–V8 over the draft report, then applies the failure policy (docs/specs/agent-and-verifier.md §7).
- **Engine bugs fail the job:** a V2 or V3 mismatch, or a cited row that doesn't exist, writes a diagnostic and ships nothing.
- **Bad claims are dropped or downgraded:**
  - claims failing V1, V4, V5 or V8 are dropped;
  - V6 rewrites causal wording to correlational wording.
- **The cascade** drops findings left without claims and recommendations left without findings, along with references to them.

- **Spec:** docs/specs/agent-and-verifier.md §7
- **Status:** built in M9.

## Public API

- `verifyReport(draft, { ws, defs, catalog, grain, periodEnd, judge? })` returns `{ report, checks }`. It throws `VerifyError` (`RECOMPUTE_MISMATCH`, `REDERIVE_MISMATCH`, `CITATION_MISMATCH`, `UNVERIFIABLE`) with a diagnostic.
- V5's judge: a quoted span the screen flags is sent as “withheld”; a provider failure (TIMEOUT, RATE_LIMITED, PROVIDER) skips the judge for that claim ("judge unavailable" in its check row, and after a rate limit for the rest of the report), an answer that never validates counts as "not supported", and any other error stops VERIFY.
- V1 drops a claim saying "more than the whole" unless it cites an `abs_exceeds` fact equal to 1 whose first input is the change of the member quoted just before the phrase (agent-and-verifier §7, M14a).
- `recomputeFacts(ws, facts, all)` is V2. SQL facts are re-run with their stored parameters. The Pareto and concentration facts (analysis-library §11) are SQL that returns a row per member: V2 also recomputes the class counts and values, the top-N shares and the HHI in code from the members' totals (`pareto_class`, `top_n_share`, `hhi`; `concentration-check.ts`). Function facts are recomputed from their inputs by a registry (`delta`, `sum`, `abs`, `abs_exceeds`, `mean`, `pct_change`, `share`, `contribution.v1`, `hhi`, `theil_sen`, `mann_kendall`, `robust_z`, `share_shift`, `pvm.v1`, `pvm_margin.v1`, `gross_margin`, `gross_margin_pct`, `ratemix.v1`, `noise_band`, `impact.v1:*`, `scenario_param` bounds, `external_quote` re-parsing, `benchmark_gap.v1`). The relative tolerance is `TOLERANCE` = 1e-9.
- The scorecard's `material` flag (analysis-library §12) is recomputed with `materiality()` from the row's change, change %, band and mean facts (`recheckMaterial`, `sections-check.ts`); a different flag is a `RECOMPUTE_MISMATCH`. An "Analyses not run" reason with a free numeral or a placeholder is dropped and listed (V1, `checkNotRun`). A concentration entry whose dependence finding was dropped loses its `dependence` link.
- V4 for margin (`margin-check.ts`): a claim that names margin (EN/RU/UZ lexicon) is dropped unless one of its facts is measured from a metric that reads a column with role `unit_cost` or `cost_amount` (`costRoleMetrics`, `marginClaimProblem`), and a `gross_margin` or `gross_margin_pct` fact must be built from its definition's revenue and cost terms of its own period and member (`marginFactProblem`).
- `isCausal(text)` and `rewriteCorrelational(text)` are V6's EN/RU/UZ lexicon and its rewrites.
- `checkFactRows(ws, facts)` is the part of V5 that checks a fact's cited rows exist in its table.
- `persistChecks(ws, checks)` writes one row per check to the `verification` table.

## Example

```ts
const { report, checks } = await verifyReport(draft, { ws, defs, catalog, grain: "month", periodEnd: "2026-06-30", judge: model });
// report.verification: numbers_checked, rederived_metrics, definition_violations, citations_checked/unsupported,
// claims_dropped, claims_downgraded
```

In a job, the VERIFY stage reads `report.draft.json` and writes `report.json`. On an engine bug it writes `diagnostics.json` instead.
