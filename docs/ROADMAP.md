# Roadmap: v0.1, milestone by milestone

Each milestone ends with a demo command, green CI and a short summary. The work runs in order. After M1 locks the contracts, some milestones can run in parallel, and those are marked ∥.

Everything up to M12 uses free and local models only.

---

## M0: Foundation

**Build:**
- Bun workspaces + Turborepo monorepo with the layout from ARCHITECTURE §5 (empty packages with READMEs).
- TypeScript strict, Biome, Vitest.
- `bun run check` (lint + typecheck + test + schema drift).
- GitHub Actions CI (Bun for installs, Node 22 runtime, cache Bun).
- LICENSE (Apache-2.0), `.env.example`, `.gitignore`.
- `docker-compose.yml` skeleton with profiles.
- Placeholder `aa doctor`.

**Acceptance:**
- `bun install && bun run check` passes on a clean clone.
- CI is green on the first PR.
- `aa doctor` prints Node and DuckDB versions, and which model providers are reachable (it's fine if none are).

## M1: Contracts and golden fixtures

**Build:**
- `packages/schema`:
  - the report v1 Zod schema (specs/report-schema.md), plus metric YAML, config and events schemas;
  - JSON Schema export;
  - the drift check.
- The full fixture `report.coffee-roaster.json`.
- `packages/report`: React SSR of the fixture into self-contained HTML with clickable numbers and citations, matching the blueprint's input/output section.
- `evals/datasets/coffee-roaster-v1`, hand-built: files + `answers.yaml` (mirrors the blueprint numbers).
- `packages/models`: the `ModelClient` interface + `FakeModel` + `ollama` + `openai-compatible` providers.

**Acceptance:**
- The fixture validates.
- `bun run --filter @agentic-analytics/report render:fixture` produces an HTML file that works offline, with a working citation highlight.
- `FakeModel` is used in a sample test.
- `aa doctor` can call the configured model with a one-line prompt.

## M2: Ingestion ∥

**Build:**
- `packages/ingest` per specs/ingestion-and-profiling.md §1–4.
- `fixtures/xlsx/*` nasty spreadsheets (at least 12) with expected outputs.
- Parsers: PDF (`unpdf`), DOCX, EML.
- Docling client + compose profile.
- Provenance on everything.

**Acceptance:**
- All xlsx fixtures match the expected tables.
- Mixed PDF, DOCX and EML files produce sections with page and offset.
- A corrupted file yields a `QualityIssue`, not a crash.

## M3: Workspace and profiling ∥ (after M2's table output format is fixed)

**Build:**
- `packages/store`: per-job DuckDB with migrations (ARCHITECTURE §3).
- `packages/profile`: profiling, normalization, entity matching (spec §5–7).

**Acceptance:**
- The coffee-roaster dataset loads.
- The profile finds the planted ×1000 typo and the date-format ambiguity.
- Entity matching links "OOO Hotel Group" and "Hotel Group LLC".

## M4: Metric layer

**Build:**
- `packages/metrics`: draft (model + deterministic fallback), validate, compile to SQL, the confirm flow in the CLI.

**Acceptance:**
- On coffee-roaster, `revenue`, `wholesale_revenue` and `refund_rate` are drafted correctly with `FakeModel`, and with a real free model in a manual check (DEFERRED if no model is configured).
- Invalid proposals are rejected with reasons.
- Compiled SQL matches hand-computed values.

## M5: Analysis library ∥

**Build:**
- `packages/analysis`: measure, baselines and noise, every insight template, `contribution.v1`, `pvm.v1`, `ratemix.v1` + the Simpson guard, `diff.v1`, `impact.v1`, ranking (specs/analysis-library.md).

**Acceptance:**
- Every method has hand-computed tests.
- The PVM identity property test passes.
- The Simpson fixture triggers the guard.
- The coffee-roaster golden outputs are exact: −17.9%, 108%, 1.2%→3.4%.

## M6: Retrieval ∥

**Build:**
- `packages/retrieval`: chunking, FTS, in-process ONNX embeddings (transformers.js), exact vector search, RRF, ONNX reranker, citations.

**Acceptance:**
- Recall@8 ≥ 0.85 on the coffee-roaster and printing-shop corpora.
- It works with the reranker missing (degraded flag).

## M7: Agent

**Build:**
- `packages/agent`:
  - the fact sheet;
  - the quarantined extractor;
  - the tools;
  - EXPLAIN and DECIDE;
  - small-model mode;
  - prompts with snapshot tests.
- `packages/core`: the pipeline state machine, checkpoints/resume and the event bus.

**Acceptance:**
- An end-to-end job on coffee-roaster with `FakeModel` produces a draft report with placeholders only.
- A manual run with a free model finds P1 and P2 (DEFERRED if no model is configured).
- Resume after killing the process mid-job works.

## M8: Web lane

**Build:**
- `packages/web`: the SearXNG provider, the query sanitizer, a safe fetcher (IP blocks, limits) and readable-text extraction.
- External facts feed `benchmark_gap.v1`.

**Acceptance:**
- Sanitizer tests show no private values ever reach queries.
- The SSRF tests block private IPs.
- A web-enabled run labels external claims.

## M9: Verifier

**Build:**
- `packages/verify`: passes V1–V8 and the failure policy (specs/agent-and-verifier.md §7).
- The injection suite (at least 20 fixtures).

**Acceptance:**
- Seeded bad drafts (a free numeral, a wrong definition, an unsupported citation, causal overreach, an ungrounded recommendation) are each dropped or downgraded correctly.
- A V2 mismatch fails the job with a diagnostic.
- The injection suite passes 100%.

## M10: Doors

**Build:**
- `apps/server` (all endpoints + SSE + OpenAPI);
- `apps/cli` (all commands, live stage view, metric review);
- `apps/mcp` (tools + resources);
- `apps/telegram`;
- `apps/viewer`;
- the final report HTML.

**Acceptance:**
- The same dataset gives an identical `report.json` (facts) via the CLI, the API and MCP.
- Claude Desktop config from the docs works (DEFERRED if Claude Desktop or a model isn't available).
- The Telegram bot works with long polling.

## M11: Evals at scale

**Build:**
- `evals/generator` (archetypes, planted events, distractors).
- 30+ datasets.
- The runner and scoring.
- `RESULTS.md`.
- CI smoke suite.

**Acceptance:**
- The full suite runs locally with one command.
- The full harness runs end to end with FakeModel.
- Real-model results are published for every free or local model that is configured. If none is, this is DEFERRED with the exact commands.
- The default model is chosen from results once they exist.

## M12: Docs site and launch

**Build:**
- `apps/docs` (Astro Starlight) per docs/DOCS-SITE.md.
- The README visuals per docs/DOCS-SITE.md §3, all generated by scripts in `scripts/readme-assets/` (`bun run readme:assets`, with a `readme:check` drift check in CI):
  - an animated SVG hero (files → tables/docs/web lanes → analyst → verifier → report): CSS-animated, light and dark variants via `<picture>`, static under `prefers-reduced-motion`;
  - a demo GIF of `aa analyze examples/coffee-roaster --open`, recorded by script (VHS for the terminal, Playwright for the report citation click);
  - Mermaid architecture and pipeline diagrams;
  - a "problems it solves" before/after table and an eval results table.
- `docker compose up` quickstart.
- A GHCR image on tag.
- Release v0.1.0 with notes.
- The repo made public.
- The launch checklist (Show HN, r/selfhosted on a Friday, r/LocalLLaMA, LinkedIn, X).

**Acceptance:**
- A fresh machine goes from clone to report in under 10 minutes, following only the docs.
- The docs site is deployed on GitHub Pages.
- `bun run readme:check` passes in CI: the hero SVGs, Mermaid blocks and tables match their generators. The README renders the hero correctly in GitHub light and dark mode, and the hero is static with reduced motion.

## After v0.1

- **M13:** optional paid providers (Anthropic, OpenAI) via the model layer, the user's own keys only.
- **P1:**
  - CausalImpact-style intervention analysis;
  - an FX table;
  - Shapley attribution;
  - DABstep/DDR-Bench subsets;
  - calibration of impact ranges.
- **P2:**
  - per-client memory (confirmed metrics, validated templates, past findings);
  - robustness "multiverse" checks;
  - scheduled monthly reports.
- **Product:** a hosted NestJS app (accounts, connectors, scheduling, teams) built on the engine packages.
