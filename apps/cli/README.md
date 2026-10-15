# @agentic-analytics/cli

The `agentic-analytics` / `aa` command line (citty).

- **Status:** M0 ships `aa doctor`. The other commands land in M10.
- **Spec:** docs/specs/interfaces.md §2

## Commands

| Command | Does |
|---|---|
| `aa doctor` | Checks Node (≥22, required), DuckDB (required), Ollama, free OpenAI-compatible endpoints whose key is set (Groq, OpenRouter), SearXNG and Docling. Prints a fix for each missing piece. Exits 1 only if a required check fails. |

## Public API

`runDoctor(deps)`, `formatReport(results)`, `exitCode(results)` and their types are exported from `src/index.ts`. `fetch`, env and the DuckDB probe are injected, so tests never touch the network.

## Example

```bash
bun run aa doctor
```
