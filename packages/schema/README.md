# @agentic-analytics/schema

Zod contracts: report v1, metric YAML, config and events; JSON Schema export.

- **Status:** M0 ships the JSON Schema export and the drift check. The schemas themselves land in M1.
- **Spec:** docs/specs/report-schema.md

## Public API

| Export | Does |
|---|---|
| `jsonSchemaRegistry` | Every schema exported as JSON Schema, keyed by file name (empty until M1) |
| `generateJsonSchemas(registry)` | Renders each Zod schema to a pretty-printed JSON Schema body via `z.toJSONSchema` |
| `compareSchemas(generated, committed)` | Returns `{ changed, missing, extra }` file lists |
| `hasDrift(report)` | `true` if any list is non-empty |

## Example

```bash
bun run schema:drift   # part of `bun run check`; fails if packages/schema/json/ is stale
bun run schema:write   # regenerate packages/schema/json/ after changing a schema
```
