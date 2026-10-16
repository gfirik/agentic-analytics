# @agentic-analytics/docs

The docs site: Astro Starlight, deployed to GitHub Pages at https://gfirik.github.io/agentic-analytics/.

- **Status:** built in M12. The site deploys once the repo is public and Pages is enabled (docs/LAUNCH.md).
- **Spec:** docs/DOCS-SITE.md

## How it stays true

`scripts/generate.ts` runs before every build, dev server and typecheck:

- It runs the real engine on `examples/coffee-roaster` with the scripted model (no LLM, offline embedder). It records the event log, the draft and verified reports, and a real retrieval trace with the extractor's output. These feed the islands.
- It renders the HTTP API reference from the server's own OpenAPI spec, and the report schema from its JSON Schema.
- It copies the eval results, decisions, roadmap and changelog.

Everything it writes is gitignored. Mermaid diagrams come from the same `docs/assets/diagrams/*.mmd` files the README embeds.

## Islands (React, `client:visible`)

- `Pipeline`: replays the run's events.
- `CitationDemo`: click a citation to see the cited rows or passage.
- `Decomposition`: the contribution waterfall.
- `RagStepper`: BM25 → vectors → RRF → rerank → extract.
- `VerifierDiff`: the draft against the verified report.
- `Mermaid`: the shared diagrams.

All of them use Starlight's theme variables (light and dark) and turn motion off under `prefers-reduced-motion`.

## Example

```bash
bun run --filter @agentic-analytics/docs dev     # http://localhost:4321/agentic-analytics/
bun run --filter @agentic-analytics/docs build   # → apps/docs/dist
```

Astro 5 is pinned because Astro 7 needs Node ≥ 22.22.
