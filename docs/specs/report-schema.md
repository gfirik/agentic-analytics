# Spec: report schema `agentic-analytics.report/v1`

The report is the product's contract. It is defined in Zod in `packages/schema/src/report.ts`. JSON Schema is generated into `packages/schema/json/report.schema.json` (committed, guarded by the drift check) and published with every release. Field names are stable within v1. Fields can only be added, never removed or renamed.

## 1. Top level

```ts
Report = {
  schema: "agentic-analytics.report/v1",
  job_id: string,
  generated_at: string,          // ISO 8601
  engine: { version: string, models: { role: "planner"|"extractor"|"judge"|"embedder"|"reranker", provider: string, model: string }[] },
  period: { from: string, to: string, grain: "day"|"week"|"month"|"quarter"|"year" },
  objective: { text: string, source: "user"|"default" },     // business goal used to rank decisions
  sources: Source[],
  metrics: MetricDef[],          // confirmed or assumed definitions actually used
  assumptions: Assumption[],     // anything not confirmed by the user
  data_quality: QualityIssue[],
  summary: { headline: string, bullets: Claim[] },          // ≤ 5 bullets
  findings: Finding[],
  recommendations: Recommendation[],
  open_questions: OpenQuestion[],
  facts: Fact[],                 // every number referenced anywhere
  verification: VerificationSummary,
  evidence?: Evidence[],        // additive (M1): source excerpts the HTML shows offline, see §5a
  // additive (M15), see §5b; each is optional, so every v1 report stays valid
  roles?: ColumnRole[],
  table_kinds?: TableKind[],
  business_model?: BusinessModel,
  scorecard?: Scorecard,
  concentration?: Concentration[],
  analyses_not_run?: NotRun[]
}
```

## 2. Provenance

```ts
Source = {
  id: string,                    // "S1"
  file: string, sha256: string,
  kind: "table"|"document"|"email"|"web",
  external: boolean,             // true only for web
  locator: TableLocator | DocLocator | WebLocator
}
TableLocator = { sheet?: string, range: string /* A1 e.g. "A3:F120" */, table_id: string }
DocLocator   = { page?: number, section?: string, char_start: number, char_end: number }
WebLocator   = { url: string, title: string, fetched_at: string }

Citation = { source_id: string, rows?: number[], cells?: string[], quote?: string /* ≤ 300 chars, docs/web only */ }
```

## 3. Facts (the only place numbers live)

```ts
Fact = {
  id: string,                    // "N12"
  label: string,                 // "revenue_change_pct_2026-04_vs_2026-03"
  value: number,
  unit: "currency"|"percent"|"count"|"ratio"|"days"|"other",
  currency?: string,             // ISO 4217
  metric_id?: string,            // MetricDef.id this fact measures
  computation: { kind: "sql"|"function", sql?: string, params?: Record<string, unknown>, fn?: string, inputs?: string[] /* fact ids */ },
  citations: Citation[],         // input rows
  verified: boolean
}
```

Every number shown in any text field must appear as `{{N12}}`-style placeholders in the draft. The renderer substitutes formatted values. Free numerals in model text fail verification. The only exceptions are dates and quoted source text.

## 4. Claims, findings, recommendations

```ts
Claim = {
  text: string,                  // may contain {{fact_id}} placeholders
  facts: string[],
  citations: Citation[],
  causal_grade?: "observed"|"correlated"|"document_supported"|"intervention_supported",
  verified: boolean
}

Finding = {
  id: string,                    // "F1"
  type: "regression"|"improvement"|"anomaly"|"trend_break"|"concentration_risk"|"data_quality"|"benchmark_gap",
  severity: "high"|"medium"|"low",
  title: string,
  claims: Claim[],
  drivers?: { label: string, fact: string, share_of_change: string /* fact id */ }[],
  method: string,                // analysis-library method id, e.g. "pvm.v1"
  confidence: "high"|"medium"|"low",
  confidence_reasons: string[],
  assumptions: string[]          // Assumption ids
}

Recommendation = {
  id: string,                    // "R1"
  action: string,
  because: string[],             // Finding ids (≥1)
  rationale: Claim[],
  impact: { metric_id: string, low: string, high: string /* fact ids */, horizon: string, method: string, inputs: string[] },
  confidence: "high"|"medium"|"low",
  effort: "low"|"medium"|"high",
  risk: string,
  check: { metric_id: string, comparator: ">="|"<="|"between", threshold: string /* fact id */, by: string /* ISO date */ },
  not_advised?: string
}

OpenQuestion = { id: string, question: string, why_it_matters: string, would_change: string[] /* finding/rec ids */ }
Assumption   = { id: string, text: string, affects: string[] }
QualityIssue = { id: string, kind: string, severity: "high"|"medium"|"low", description: string, citations: Citation[] }
```

## 5. Verification summary

```ts
VerificationSummary = {
  numbers_checked: number, numbers_mismatched: number,        // must be 0 to ship
  rederived_metrics: number, rederivation_mismatches: number,
  definition_violations: number,
  citations_checked: number, citations_unsupported: number,
  claims_dropped: { claim: string, reason: string }[],
  claims_downgraded: { claim: string, from: string, to: string, reason: string }[]
}
```

## 5a. Metric definitions and evidence (additive in M1)

```ts
// report.metrics: the metric YAML definition (metric-layer.md §1) plus what the user saw and the compiled SQL
ReportMetric = MetricDef & { plain: string /* plain-language rendering */, sql: string }

// report.evidence (optional): excerpts of cited sources, copied verbatim, never computed
Evidence = { source_id: string, kind: "table", columns: { letter: string, name: string }[], rows: { row: number, cells: (string|number|null)[] }[] }
         | { source_id: string, kind: "text", page?: number, section?: string, char_start: number, text: string }
```

Integrity rules beyond the JSON Schema (`checkReportIntegrity`): ids are unique; every `{{N…}}` placeholder and every fact-id field points at an existing fact; placeholders in a claim are listed in `claim.facts`; citations, metric ids, assumption ids, `because` and `would_change` ids resolve; every human-readable text field (headline, titles, claims, actions, `not_advised`, risks, horizons, confidence reasons, driver labels, data-quality descriptions, open questions, assumptions) has no numerals except placeholders, dates and quoted source text — this is §3's rule applied mechanically. Only `verification.claims_dropped/claims_downgraded` are exempt, because they quote rejected text verbatim.

Prose states a decline as a magnitude: "Revenue fell {{N14}}" where N14 is `abs` of the signed change, never a signed value after "fell".

## 5b. Business semantics, scorecard and analyses not run (additive in M15)

These fields are specified here before the code. Each one lands with its PR, in Zod (`packages/schema/src/report.ts`) with the JSON Schema regenerated: `roles`, `table_kinds` and `business_model` in PR 5, `concentration` in PR 9, `scorecard` and `analyses_not_run` in PR 10. All are optional, and nothing is renamed or removed, so the schema stays `agentic-analytics.report/v1`.

```ts
// semantics §1–§2: one entry per column that has a role (columns with role "none" are left out)
ColumnRole = {
  table_id: string, column: string,
  role: Role,                               // the vocabulary in semantics §1 (a Zod enum)
  status: "confirmed"|"assumed",
  source: "detector"|"model"|"user",
  evidence: RoleEvidence[],
  assumption?: string                       // Assumption id, when assumed and read by an analysis
}
RoleEvidence = { kind: "name"|"type"|"pattern"|"identity"|"tie_break"|"user", text: string, fact?: string /* identity rate fact id */ }

// semantics §3
TableKind = { table_id: string, kind: "sales_lines"|"invoices"|"bills"|"inventory_snapshot"|"bank_cash"|"budget_plan"|"period_summary"|"other",
              evidence: string[] /* the roles that matched */ }

// semantics §4: always an assumption, never a number
BusinessModel = { model: "retail"|"wholesale"|"subscription"|"services"|"unknown", status: "confirmed"|"assumed",
                  assumption: string /* Assumption id */, signals: { text: string, fact?: string }[] }

// analysis-library §12
Scorecard = { period: string, rows: ScorecardRow[] }
ScorecardRow = {
  metric_id: string,
  value: string,                                            // fact id
  vs_base: { method: "previous_period"|"trailing_mean_3", periods: string[], change: string, change_pct?: string } | { na: NotRunReason },
  yoy: { period: string, change: string, change_pct?: string } | { na: NotRunReason },
  material: boolean | null,                                 // null with fewer than 6 periods (no noise band)
  materiality_inputs?: { band?: string, mean: string }      // fact ids V2 recomputes `material` from
}

// analysis-library §11: one entry per (metric, dimension)
Concentration = {
  metric_id: string, dimension: string /* entity or role, §14 */, column: string,
  pareto: { window: "ttm"|"ttm_prev", from: string, to: string,
            classes: { class: "A"|"B"|"C", count: string, value: string, share: string }[],   // fact ids
            members: string, nonpositive_count?: string, nonpositive_value?: string, unkeyed_value?: string }[],
  shares: { period: string, top1?: string, top3?: string, top5?: string, top10?: string, hhi: string }[],
  trend?: { hhi_slope: string, hhi_p: string, top1_slope?: string, top1_p?: string },
  dependence?: string                                         // Finding id of a dependence.v1 finding
}

// analysis-library §13: no numbers, so V1's free-numeral rule applies to `reason`
NotRunReason = "no_cost_role"|"no_quantity_role"|"no_price_role"|"no_item_dimension"|"no_variable_cost"|"no_dimension"
             | "too_few_periods"|"grain_not_comparable"|"no_order_id"|"no_customer_role"|"no_refund_role"
             | "no_discount_role"|"no_status_role"|"no_history"
NotRun = { analysis: string, reason_code: NotRunReason, reason: string, needs: string[] }
```

**Integrity (`checkReportIntegrity`) gains:**

- every fact id in these fields resolves;
- every `ColumnRole.table_id` names a source's table;
- every `assumption` id resolves;
- `scorecard.rows[].metric_id` resolves to `report.metrics`;
- `reason`, `RoleEvidence.text` and `signals[].text` are human-readable text fields with no free numerals (§5a).

Role scores are not in the report: they rank candidates inside the detector (semantics §6).

## 6. HTML report requirements

- **One self-contained file.** Inline CSS and JS, no external requests, works offline.
- **Order:** headline and summary, data-quality banner if any high-severity issues, the scorecard (M15), findings, recommendations, concentration (M15, when it ran), open questions, analyses not run (M15), assumptions, metric definitions with column roles and table kinds (M15), sources, verification panel. A section with nothing to show is left out.
- **Clicking a number** shows its computation (SQL, inputs, definition).
- **Clicking a citation** shows the source:
  - table citations render the cited rows with the cells highlighted;
  - document citations show the quoted span with page;
  - web citations show title, URL and fetch date with an **External** badge.
- **Accessibility and print:** light and dark theme, keyboard navigation, WCAG AA contrast, print-friendly CSS.
- **Visual reference:** the input-output section of `docs/assets/blueprint.html`.

## 7. Fixtures

- `packages/schema/test/fixtures/report.coffee-roaster.json` is a full valid example that mirrors the blueprint. It is used by renderer tests and docs. It is generated from the `evals/datasets/coffee-roaster-v1` ground truth (`build:golden-report`), so every number in it is computed, not typed.
- Schema drift: `bun run check` regenerates the JSON Schema and fails if it differs from the committed file without a schema-version note.
