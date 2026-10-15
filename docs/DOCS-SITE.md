# Docs site plan (`apps/docs`, Astro Starlight, deployed to GitHub Pages)

The docs are part of the product, not something added at the end. Every stage of the pipeline gets a page that shows how it works visually.

## 1. Structure

| Section | Pages |
|---|---|
| Start | What it is (1-minute read + animated pipeline), Quickstart (Docker / Bun / Ollama / free endpoint), Your first report (coffee-roaster walkthrough) |
| How it works | Pipeline overview (interactive, ported from `docs/assets/blueprint.html`); Ingest & table detection; Profiling & data quality; Metric layer; Detecting changes; Finding drivers (PVM, contribution, rate/mix, Simpson, DIFF), with worked examples and animated bar breakdowns; Documents lane (RAG: chunking, BM25, vectors, RRF, rerank, with a step-through visual); Web lane & privacy; Explain & causal grades; Decisions & impact ranges; The verifier (V1–V8 with a before/after draft example); Security & prompt injection |
| Use it | CLI, HTTP API (generated from OpenAPI), MCP (Claude Desktop / Cursor setup), Telegram demo, Viewer |
| Reference | Report schema (generated from JSON Schema), Metric YAML, Config, Insight templates list, Decomposers list |
| Models | Running free: Ollama, free endpoints, hardware guidance, small-model mode, eval results per model |
| Quality | Evals: method, datasets, results table (from `evals/RESULTS.md`), how to reproduce |
| Project | Architecture, Decisions, Roadmap, Contributing, Security policy, Changelog |

## 2. Visual components (Astro/React islands)

- **`<Pipeline />`:** the animated stage diagram. It can replay a recorded job event log, so readers watch a real run.
- **`<CitationDemo />`:** the click-a-citation, highlight-the-rows interaction from the blueprint.
- **`<Decomposition />`:** a waterfall chart that animates a PVM or contribution split.
- **`<RagStepper />`:** walks a query through BM25, vectors, RRF, rerank and extract, showing ranks changing.
- **`<VerifierDiff />`:** shows a draft report vs the verified report, with dropped and downgraded claims highlighted.
- **Mermaid** for architecture and state diagrams.
- **Accessibility:** every component respects `prefers-reduced-motion` and works in light and dark.

## 3. Rules

- Every feature PR from M12 on updates its docs page.
- Code samples are tested (extracted and run in CI where practical).
- Screenshots and GIFs are regenerated from `examples/` by script, so they never drift.
