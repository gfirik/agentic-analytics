# @agentic-analytics/store

Per-job DuckDB workspace: open, create, close, migrations, typed query helpers.

- **Status:** M0 ships only `duckdbVersion()` for `aa doctor`. The workspace lands in M3.
- **Spec:** docs/ARCHITECTURE.md §3

## Public API

| Export | Does |
|---|---|
| `duckdbVersion(): Promise<string>` | Opens an in-memory DuckDB and returns `SELECT version()`, e.g. `v1.5.6` |
| `StoreError` | Typed error with a `code` |

## Example

```ts
import { duckdbVersion } from "@agentic-analytics/store";
console.log(await duckdbVersion()); // "v1.5.6"
```
