# @agentic-analytics/docs

The product site: a custom landing page and the Astro Starlight docs, deployed to GitHub Pages at https://gfirik.github.io/agentic-analytics/.

- **Design:** `DESIGN.md` ("an AI analyst you can audit"). The tokens are in `src/styles/tokens.css`, and the shared ledger motifs (fact-ID chips, check marks, ruled tables) in `src/styles/components.css`.
- **Landing page and 404:** `src/pages/index.astro` and `src/pages/404.astro`, on `src/components/site/` (BaseLayout, header, footer, theme control).
- **Docs:** Starlight, themed by `src/styles/starlight.css` and the overrides in `src/components/starlight/` (Header, Footer, ThemeSelect, PageTitle). Code blocks use Expressive Code re-based onto the token surfaces (`astro.config.mjs`).

- **Status:** built in M12. The site deploys once the repo is public and Pages is enabled (docs/LAUNCH.md).
- **Spec:** docs/DOCS-SITE.md

## How it stays true

`scripts/generate.ts` runs before every build, dev server and typecheck:

- It runs the real engine on `examples/coffee-roaster` with the scripted model (no LLM, offline embedder). It records the event log, the draft and verified reports, and a real retrieval trace with the extractor's output. These feed the islands.
- It renders the HTTP API reference from the server's own OpenAPI spec, and the report schema from its JSON Schema.
- It copies the eval results, decisions, roadmap and changelog.

- It writes the landing page's data:
  - `landing.json`: finding F1 of the hero's web-enabled run (the same run as `pipeline.json`, checked), with every fact behind it;
  - `evals.json`: the eval runner's own `summarize()` over the latest `evals/results/*.json`, plus the real-data checks.

Everything it writes is gitignored. The `Pipeline` island's data is the exception: it is the README GIF's data, so it is checked in at `docs/assets/readme/pipeline.json`. `scripts/pipeline-data.ts --write` regenerates it from one web-enabled run (scripted planner, offline web fixture) — the event log's stage order, the verified report's facts and citations, the verifier's check table — and a test (`scripts/test/pipeline.test.ts`) reruns the engine and fails if the file drifts.

The Learn section's data is checked in too, at `docs/assets/learn/learn.json`: `scripts/learn-data.ts --write` records it from real runs (the same web-enabled run as `pipeline.json`, the CLI's own output for each tutorial, the MCP server, the model router on a scripted transport, an injection fixture), and `scripts/test/learn.test.ts` re-records it and fails on drift.

Mermaid diagrams come from the same `docs/assets/diagrams/*.mmd` files the README embeds.

## Islands (React, `client:visible`)

- `Pipeline`: the animated pipeline, the same scene the README GIF is recorded from (`src/components/pipeline-scene.ts`), played from `docs/assets/readme/pipeline.json`.
- `CitationDemo`: click a citation to see the cited rows or passage.
- `Decomposition`: the contribution waterfall.
- `RagStepper`: BM25 → vectors → RRF → rerank → extract.
- `VerifierDiff`: the draft against the verified report.
- `Mermaid`: the shared diagrams, in the site's colours and type.
- `LedgerReport` (landing page): the report with clickable fact IDs. Without JS the chips link into the static fact ledger.
- `learn/StageFlow` (Learn): one stage as in → stage → out with the run's real numbers, stepped through; `learn/Transcript`, `learn/Fact`, `learn/FactLedger`, `learn/Claim` and `learn/LearnMap` are static Astro components.

All of them:

- use the site tokens (light and dark);
- render their final state on the server;
- turn motion off under `prefers-reduced-motion`.

## Example

```bash
bun run --filter @agentic-analytics/docs dev     # http://localhost:4321/agentic-analytics/
bun run --filter @agentic-analytics/docs build   # → apps/docs/dist
bun run --filter @agentic-analytics/docs assets  # re-render public/og.png and public/favicon.ico (Playwright)
bun run site:check:browser                       # browser checks on the built site (PW_CHANNEL=chrome locally)
tsx apps/docs/scripts/learn-data.ts --write      # re-record the Learn data (docs/assets/learn/learn.json)
```

Astro 5 is pinned because Astro 7 needs Node ≥ 22.22.
