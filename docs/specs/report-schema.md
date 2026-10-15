# Spec: report schema `agentic-analytics.report/v1`

The report is the product's contract. It is defined in Zod in `packages/schema/src/report.ts`. JSON Schema is generated into `packages/schema/dist/report.schema.json` and published with every release. Field names are stable within v1. Fields can only be added, never removed or renamed.

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
  verification: VerificationSummary
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

## 6. HTML report requirements

- **One self-contained file.** Inline CSS and JS, no external requests, works offline.
- **Order:** headline and summary, data-quality banner if any high-severity issues, findings, recommendations, open questions, assumptions, metric definitions, sources, verification panel.
- **Clicking a number** shows its computation (SQL, inputs, definition).
- **Clicking a citation** shows the source:
  - table citations render the cited rows with the cells highlighted;
  - document citations show the quoted span with page;
  - web citations show title, URL and fetch date with an **External** badge.
- **Accessibility and print:** light and dark theme, keyboard navigation, WCAG AA contrast, print-friendly CSS.
- **Visual reference:** the input-output section of `docs/assets/blueprint.html`.

## 7. Fixtures

- `packages/schema/test/fixtures/report.coffee-roaster.json` is a full valid example that mirrors the blueprint. It is used by renderer tests and docs.
- Schema drift: `bun run check` regenerates the JSON Schema and fails if it differs from the committed file without a schema-version note.
