# PRD: agentic-analytics v0.1

PRD stands for Product Requirements Document. It says what we are building, for whom, why, what is in and out of scope, and how we will know it works. Specs in `docs/specs/` say how each part works.

## 1. Problem

Small and mid-size businesses keep their reality in scattered files: sales spreadsheets, accounting exports, price lists, contracts, supplier emails and notes. Owners rarely have an analyst. When something goes wrong, such as revenue dropping, refunds rising or a big client going quiet, they find out late. They also can't see why it happened or what to do about it.

AI tools promise to fix this, but users report three failures:

1. **Wrong numbers.** Models do the math themselves or read spreadsheets as text. Microsoft's Excel agent scored 57% vs 71% for humans on SpreadsheetBench, and review sites are full of "confidently wrong" complaints.
2. **Correct math on the wrong quantity.** The newest enterprise benchmark (Argo-Bench, Oct 2026) found this is the dominant failure. The model reads the wrong record, optimizes the wrong objective, or measures a nearby metric.
3. **Generic advice with no evidence,** and no way for the owner to check any of it.

Business data is also private, and owners are rightly wary of uploading it to a vendor.

## 2. Product

An open-source engine you run yourself. You give it files and get back a business diagnosis:

- the history and key metrics;
- what changed and the drivers behind each change;
- where things went wrong;
- outside context from the web;
- ranked recommendations.

Every number is computed and verified, and every claim is cited. It runs fully locally at $0.

**Category:** agentic analytics. **Plain words:** an AI data analyst you can audit.

## 3. Users

| User | Need | Door |
|---|---|---|
| **Business owner or manager** (no analyst) | "Tell me what happened, why, and what to do, and let me check it." | Report viewer, Telegram demo |
| **Developer or agency** (us included) | Plug trustworthy analysis into a product or client project | HTTP API, Docker |
| **AI agent user** (Claude Desktop, Cursor and others) | Give an assistant analysis it can't hallucinate | MCP server |
| **Technical evaluator** (CTO, hiring manager, open-source reader) | See deep, well-engineered RAG and agent work | Repo, docs site, eval results |

## 4. Goals for v0.1

1. **Ingestion.** Turn messy real-world files into clean tables and searchable documents with full provenance. Formats: XLSX, CSV, PDF (text and scanned via optional Docling), DOCX, EML.
2. **Profiling.** Profile data quality and normalize dates, currency, units and periods. Match the same entities across files.
3. **Metric layer.** Draft metric definitions automatically, get them confirmed by the user, and carry any unconfirmed assumptions forward visibly.
4. **Detection and decomposition.** Detect changes and decompose them into drivers with deterministic, tested methods.
5. **Explanation.** Explain drivers using documents (hybrid RAG) and the web (labelled external), with graded causality.
6. **Recommendations.** Produce ranked recommendations with impact ranges, confidence, evidence and a check metric and date.
7. **Verification.** Verify every number, definition and citation before output.
8. **Output.** Deliver `report.json` (a typed, versioned schema) and `report.html` (clickable citations).
9. **Interfaces.** Expose the engine through a CLI, an HTTP API, an MCP server and a Telegram demo.
10. **Zero cost.** Run with local models (Ollama) or free OpenAI-compatible endpoints. No paid service is needed for anything.
11. **Proof.** Publish eval results on synthetic businesses with planted answers, one score per model.
12. **Docs.** Ship a docs site that visually explains every stage.

## 5. Non-goals for v0.1

- Live data connectors (Google Sheets, QuickBooks, Xero, CRMs). v0.2+.
- Dashboards or BI-style exploration UI. We produce reports, not a BI tool.
- Multi-user accounts, auth, billing, multi-tenancy. These belong to the future hosted product, a separate NestJS app.
- Paid model providers (Anthropic, OpenAI). They are trivial to add later through the model layer. Not before M13.
- Free-form code execution by the agent.
- Advanced causal inference (CausalImpact, Bayesian structural time series). P1, after v0.1.
- Forecasting beyond simple seasonal baselines.

## 6. User stories

1. As an owner, I upload my sales export and supplier emails and get a report saying revenue fell 18% in April, mostly from wholesale, starting right after our price change. I can click to see the rows and the email.
2. As an owner, before the analysis runs I'm shown "Revenue = sum of `Amount` where `Status` ≠ refunded, monthly, UZS", and I can change it.
3. As an owner, each recommendation tells me what to do, roughly how much it's worth, how sure the engine is, and what to check next month.
4. As a developer, I `POST /v1/jobs` with files and get a JSON report that validates against a published schema.
5. As a Claude Desktop user, I ask "why did refunds jump?" and the assistant calls the MCP tool and answers with citations.
6. As a privacy-conscious user, I run everything offline with Ollama and confirm no network calls happen except to the endpoints I configure.
7. As an evaluator, I open the docs and watch an animated walkthrough of a real run, then read the eval table.

## 7. Functional requirements

Each requirement gets a spec section reference.

- **FR-1. Ingestion.** Accept up to 50 files / 200 MB per job. Detect file type by content, not extension. Record provenance for every table cell range and document span. (specs/ingestion-and-profiling.md)
- **FR-2. Table detection.** Find multiple tables per sheet, unmerge headers, detect header rows and drop subtotal and total rows (flagged as such). (ingestion-and-profiling.md §3)
- **FR-3. Profiling.** Per column: type, null %, distinct count, min, max and outliers. Per table: duplicates, date coverage and gaps. Report implausible values. (ingestion-and-profiling.md §5)
- **FR-4. Normalization.** Parse dates in mixed formats (including `dd.mm.yyyy`), currency symbols and codes, thousands separators in several locales, and percentages. Align to periods. (ingestion-and-profiling.md §6)
- **FR-5. Entity matching.** Link the same customer or product across files using normalization plus DuckDB string similarity, with a confidence score on each link. (ingestion-and-profiling.md §7)
- **FR-6. Metric layer.** Draft metric definitions in YAML. Require confirmation (interactive or API), or run with `--yes` and mark the definitions as assumptions. (specs/metric-layer.md)
- **FR-7. Insight detection.** Run the full insight-template library across every confirmed metric × dimension × period. (specs/analysis-library.md §2)
- **FR-8. Decomposition.** Decompose every material change with the appropriate method and run the Simpson guard. (analysis-library.md §3)
- **FR-9. Retrieval.** Hybrid retrieval over documents (BM25 + vectors, fused with RRF, then reranked), with citations to page and span. (specs/retrieval.md)
- **FR-10. Web context.** Optional web lane. Queries never contain private data, and results are always labelled external. (specs/security.md, specs/agent-and-verifier.md §4)
- **FR-11. Explanation.** Every explanation is graded as observed, correlated, document-supported or intervention-supported. (agent-and-verifier.md §5)
- **FR-12. Recommendations.** Each recommendation has an action, `because` finding IDs, an impact range with method, confidence, effort, risk, a check (metric + threshold + date) and a "not advised" note when relevant. (agent-and-verifier.md §6)
- **FR-13. Verifier.** Recompute every number, re-derive headline metrics independently, check definitions and citation entailment, and flag causal language. On failure, drop or downgrade the claim and log the reason. (agent-and-verifier.md §7)
- **FR-14. Outputs.** `report.json` validates against schema `agentic-analytics.report/v1`. `report.html` is self-contained, with clickable citations. (specs/report-schema.md)
- **FR-15. Interfaces.** CLI, HTTP API with SSE progress, MCP server, Telegram demo. (specs/interfaces.md)
- **FR-16. Follow-up Q&A.** Ask questions against a finished job. Answers follow the same no-arithmetic and citation rules. (interfaces.md)
- **FR-17. Explain a number.** Return the SQL, input rows and definition behind any figure. (interfaces.md)

## 8. Non-functional requirements

- **Cost:** $0 to run and to develop. No paid dependency.
- **Privacy:**
  - Local by default.
  - The only network calls are to configured model endpoints, the configured search engine and fetched result pages, and the web lane is off by default.
  - No telemetry.
- **Determinism:** the same inputs and the same confirmed metrics give identical numbers. LLM wording may vary; facts may not.
- **Performance on a laptop CPU** (Ryzen 5 7520U class, 16 GB RAM, Ollama 9B model). For a sample job of 3 spreadsheets (~20k rows) plus 10 PDFs:
  - ingest and profile in under 2 minutes;
  - full report in under 15 minutes.
  - With a free hosted endpoint, the full report takes under 4 minutes.
- **Robustness:**
  - A bad file never kills a job: it becomes a data-quality finding.
  - Jobs resume after a crash from the last completed stage.
- **Security:** see specs/security.md. Prompt-injection test suite in CI.
- **Accessibility:** the HTML report meets WCAG 2.1 AA for contrast and keyboard use.
- **Install:** `docker compose up` or `pnpm i && pnpm dev`.

## 9. Success metrics

Measured by `evals/`:

| Metric | v0.1 bar |
|---|---|
| Number mismatches after verification | 0, always |
| Planted-insight recall (top findings) | ≥ 80% with the reference free model |
| Distractor false-positive rate | ≤ 10% |
| Citation precision (claim supported by its source) | ≥ 95% |
| Definition adherence (numbers match confirmed metric) | 100% |
| Recommendation grounding (every rec cites ≥ 1 verified finding) | 100% |
| Prompt-injection suite (no instruction from data followed) | 100% pass |

Launch targets, which matter but don't gate the release: a public repo with a docs site, a demo GIF and published eval tables, posted to Show HN, r/selfhosted and r/LocalLLaMA.

## 10. Risks

- **Small local models reason poorly.** Mitigations: deterministic analysis does the heavy lifting, a narrower "small-model mode" is available, and per-model scores are published.
- **Messy real files beat the parsers.** Mitigations: a corpus of nasty fixture files, Docling fallback, and data-quality findings instead of crashes.
- **Scope creep.** The non-goals above are firm for v0.1.
- **A competitor adds the missing piece** (GPT Researcher, DB-GPT). Mitigation: our moat is verification plus the metric layer plus evals, so ship those first.

## 11. Open questions

- The product and brand name, decided before launch. The repo name `agentic-analytics` is final for now.
- The default free model once evals exist. Chosen by eval score, not by preference.
