# Changelog

## v0.1.0 (unreleased)

The first release: files in, a verified and cited report out.

- **Ingest and profile.**
  - Spreadsheets as real tables: region detection, merged headers, totals, several tables per sheet.
  - CSV; PDF, DOCX, EML, MD and TXT sections; an optional Docling path for hard PDFs.
  - Profiling with data-quality findings (unit errors, ambiguous dates, duplicates, gaps) and entity matching.
- **Metric layer.** Definitions drafted (by a model or by deterministic fallbacks), validated by code, shown in plain words, confirmed or kept as flagged assumptions. Each compiles to parameterized SQL.
- **Analysis.**
  - Ten insight templates with noise bands and materiality.
  - Contribution, price–volume–mix, and rate vs mix with a Simpson guard.
  - Impact ranges computed in code.
  - Ranking with one slot per metric family.
- **Documents lane.** BM25 + vector search in DuckDB, reciprocal-rank fusion, an optional reranker, and quarantined extraction with exact quotes.
- **Web lane** (opt-in). A self-hosted SearXNG, sanitized queries, connect-time SSRF blocking, and external benchmarks that are labelled and can never replace your numbers.
- **Agent.** EXPLAIN with fixed tools and causal grades, DECIDE with scenarios, follow-up questions answered with verified claims, and small-model mode.
- **Verifier.** V1–V8. Facts are recomputed and headline metrics re-derived, so a mismatch fails the job. Citations are checked, with a judge model. Causal wording is policed. Recommendations must be grounded.
- **Security.**
  - Injection screening (EN/RU/UZ, look-alike letters, hidden text) and a quarantine; a 23-fixture injection suite in CI.
  - No free code execution.
  - A DNS-rebinding guard and bearer auth on the API.
- **Doors.**
  - CLI: `analyze`, `ask`, `explain`, `serve`, `mcp`, `jobs`, `eval`, `doctor`.
  - HTTP API with SSE and OpenAPI.
  - MCP over stdio and HTTP.
  - Telegram bot (long polling).
  - Vite viewer.
- **Report.** Self-contained `report.html` with clickable citations, cited evidence excerpts and a fact panel for every number.
- **Evals.**
  - 30 generated businesses with planted events, distractors and quality issues, scored honestly; one-command runs.
  - Smoke results for three free Groq models.
  - The v0.1 bars are not all met yet: see evals/RESULTS.md.
- **Models.** Ollama and OpenAI-compatible free endpoints, with rate-limit waits, per-request timeouts and retries of the endpoint's own JSON validation.
