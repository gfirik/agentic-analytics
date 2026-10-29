# @agentic-analytics/schema

Zod contracts for the engine: report v1, metric YAML, config and job events, with JSON Schema generated from them.

- **Spec:** docs/specs/report-schema.md, docs/specs/metric-layer.md §1, docs/specs/models.md §4
- **Status:** M1. Contracts are locked; fields may be added within v1, never removed or renamed.

## Public API

| Export | Does |
|---|---|
| `Report`, `Fact`, `Claim`, `Finding`, `Recommendation`, `Source`, `Citation`, `Evidence`, … | Report v1 schema parts (Zod values and inferred types) |
| `validateReport(json)` | Zod shape check, then `checkReportIntegrity`; returns `{ ok, report }` or `{ ok: false, issues }` |
| `checkReportIntegrity(report)` | Cross-reference rules: every `{{N…}}` placeholder and fact id exists, citations point at sources, no free numerals in model text |
| `ColumnRole`, `TableKind`, `BusinessModel`, `COLUMN_ROLES`, `TABLE_KINDS` | Business semantics in the report (M15, additive and optional): a role per column with evidence, a kind per table, and the business model as an assumption (report-schema §5b) |
| `Scorecard`, `ScorecardRow`, `Concentration`, `NotRun`, `NotRunReason`, `NOT_RUN_REASONS` | The scorecard, concentration and "Analyses not run" sections (M15 PR 10, additive and optional). `checkReportIntegrity` resolves their fact ids, metric ids and dependence finding, and holds each not-run reason to the no-numeral rule |
| `findFreeNumerals(text)`, `placeholders(text)` | Text helpers shared with the verifier (M9) |
| `MetricDef`, `MetricFile` | Metric YAML |
| `Config`, `RoleModel` | `agentic-analytics.config.yaml` |
| `JobEvent`, `Stage` | Pipeline events (SSE and the `events` table) |
| `jsonSchemaRegistry`, `generateJsonSchemas`, `compareSchemas`, `hasDrift` | JSON Schema export and the drift check |

Generated JSON Schema is committed in `json/` (`report.schema.json`, `metrics.schema.json`, `config.schema.json`, `events.schema.json`).

## Example

```ts
import { validateReport } from "@agentic-analytics/schema";
const res = validateReport(JSON.parse(text));
if (!res.ok) for (const i of res.issues) console.error(i.path, i.message);
```

```bash
bun run --filter @agentic-analytics/schema validate:fixture   # validates test/fixtures/report.coffee-roaster.json
bun run schema:write                                          # regenerate json/ after a schema change
```

The golden fixture `test/fixtures/report.coffee-roaster.json` is generated from the dataset ground truth by
`bun run --filter @agentic-analytics/eval-datasets build:golden-report`; never edit it by hand.

- `screen(text)`, `screenText(text)`: the deterministic injection screen (security §3), shared by every layer. `_` is read as a space, so snake_case identifiers are screened as words.
- `findFreeNumerals(text, years?)`, `periodYears(labels)`: the free-numeral guard behind V1 (a bare year is a date only if it is one of `years`, the job's period years read by `periodYears` from where a period sits in fact labels).
