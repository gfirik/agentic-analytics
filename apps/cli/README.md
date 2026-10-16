# @agentic-analytics/cli

The `agentic-analytics` / `aa` command line (citty).

- **Status:** M0–M1 ship `aa doctor` (with a one-line call to the configured planner model). The other commands land in M10.
- **Spec:** docs/specs/interfaces.md §2

## Commands

| Command | Does |
|---|---|
| `aa doctor` | Checks Node (≥22, required), DuckDB (required), Ollama, every configured OpenAI-compatible endpoint (keyed ones are probed), SearXNG and Docling; then calls the planner model with a one-line prompt if its provider is reachable. Prints a fix for each missing piece. Exits 1 only if a required check fails. |

## Public API

`runDoctor(deps)`, `formatReport(results)`, `exitCode(results)` and their types are exported from `src/index.ts`. `fetch`, env and the DuckDB probe are injected, so tests never touch the network.

## Example

```bash
bun run aa doctor
```
