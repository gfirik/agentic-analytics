# @agentic-analytics/store

The per-job DuckDB workspace: one database file per job, schema migrations, parameterized SQL, bulk loading.

- **Spec:** docs/ARCHITECTURE.md §3, DECISIONS D2
- **Status:** M3.

## Public API

| Export | Does |
|---|---|
| `Workspace.open(path?)` | Opens or creates a job workspace (`:memory:` by default) and runs pending migrations |
| `ws.run(sql)`, `ws.all(sql)`, `ws.one(sql)` | Execute parameterized SQL; rows come back as plain objects (BIGINT → number when safe) |
| `ws.append(table, rows)` | Bulk insert through DuckDB's appender |
| `sql\`…${value}…\`` | Tagged template: values become `$n` parameters; `ident(name)` / `idents([...])` splice checked snake_case identifiers; `fragment(sql)` splices another template |
| `loadJob(ws, { files, tables, sections, issues })` | Writes `files`, `sources` (tables and document sections, with provenance), one typed `t_<id>` per table (`_row`, `_is_total`, `_period` + data columns) and `quality_issues` |
| `MIGRATIONS` | Append-only schema versions (every ARCHITECTURE §3 table) |
| `tableName("T1")` | `"t_t1"` |
| `duckdbVersion()` | Embedded DuckDB version (used by `aa doctor`) |

## Example

```ts
import { ident, sql, Workspace } from "@agentic-analytics/store";
const ws = await Workspace.open("./data/jobs/42/workspace.duckdb");
const rows = await ws.all(sql`SELECT _period, sum(amount) AS revenue FROM ${ident("t_t1")} WHERE status <> ${"refunded"} GROUP BY 1`);
ws.close();
```
