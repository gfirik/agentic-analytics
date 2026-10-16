# @agentic-analytics/cli

The `agentic-analytics` / `aa` command line (citty).

- **Status:** M0–M1 ship `aa doctor`; M4 adds `aa metrics`; M7 adds `aa run`. The other commands land in M10.
- **Spec:** docs/specs/interfaces.md §2

## Commands

| Command | Does |
|---|---|
| `aa metrics <paths…> [--yes] [--save file] [--metrics file] [--currency CODE] [--today date]` | Ingest → profile → draft metric definitions (configured model, else deterministic fallbacks) → validate → interactive review (accept/edit/drop; `--yes` keeps drafts as assumptions) → print each metric in plain words with its SQL and recent values. `--save` writes the definitions for reuse with `--metrics`. |
| `aa run <paths…> [--dir folder] [--today date] [--currency CODE] [--objective text] [--small-model] [--web] [--embedder hash\|<model>] [--log]` · `aa run --resume <folder>` | A full job in a job folder (`input/`, `job.duckdb`, `report.draft.json`) with the configured models: ingest → profile → metrics (kept as assumptions) → measure/detect/decompose → index documents → explain → decide → draft. Prints each stage as it starts and ends. If a stage fails (e.g. no model reachable), the completed stages are kept and it prints the `--resume` command to continue. Small-model mode also turns on from the planner's model profile. VERIFY and RENDER arrive in M9/M10. |
| `aa doctor` | Checks Node (≥22, required), DuckDB (required), Ollama, every configured OpenAI-compatible endpoint (keyed ones are probed), SearXNG and Docling; then calls the planner model with a one-line prompt if its provider is reachable. Prints a fix for each missing piece. Exits 1 only if a required check fails. |

## Public API

`runDoctor(deps)`, `formatReport(results)`, `exitCode(results)` and their types are exported from `src/index.ts`. `fetch`, env and the DuckDB probe are injected, so tests never touch the network.

## Example

```bash
bun run aa doctor
```
