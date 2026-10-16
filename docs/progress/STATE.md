# STATE: build ledger

This is the single source of truth for progress between agent sessions. Agents update it inside each milestone PR. Status values: `TODO` · `IN_PROGRESS` · `AWAITING_REVIEW` · `BLOCKED` · `DONE`.

Human gate values:
- `no`: merge and continue.
- `notify`: merge, continue, and message Firdavs to review when convenient.
- `yes`: stop at AWAITING_REVIEW until Firdavs approves. Only M12 is `yes`, because making the repo public and launching is his call.

## Milestones

| Milestone | Status | Human gate | PR | Demo command | Notes |
|---|---|---|---|---|---|
| M0 Foundation | DONE | no | [#1](https://github.com/gfirik/agentic-analytics/pull/1) | `bun install && bun run check`; `bun run aa doctor` | Bun workspaces + Turborepo, CI, doctor, drift check |
| M1 Contracts & golden fixtures | IN_PROGRESS | notify | | | |
| M2 Ingestion | TODO | no | | | |
| M3 Workspace & profiling | TODO | no | | | |
| M4 Metric layer | TODO | no | | | |
| M5 Analysis library | TODO | no | | | |
| M6 Retrieval | TODO | no | | | |
| M7 Agent | TODO | no | | | |
| M8 Web lane | TODO | no | | | |
| M9 Verifier | TODO | no | | | |
| M10 Doors | TODO | no | | | |
| M11 Evals at scale | TODO | notify | | | |
| M12 Docs site & launch | TODO | yes | | | |

Order: M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12. In autopilot it runs sequentially. Parallel worktrees are an interactive option only.

## Blockers

_None._

<!-- Format: - [M<N>] <date> — <exact question or problem> — <what was tried> -->

## Deferred checks

These are checks that need something this machine doesn't have yet, such as a real LLM. Run them later.

- [M1] `aa doctor` calls the configured model with a one-line prompt — DEFERRED (no model configured); the code path is unit-tested with FakeModel and a stubbed OpenAI-format transport — `ollama pull qwen3.5:9b && bun run aa doctor` (or `GROQ_API_KEY=… PLANNER_MODEL=openai-compatible:groq:llama-3.3-70b-versatile bun run aa doctor`); expect `✓ model call  planner … replied "OK"`

<!-- Format: - [M<N>] <criterion> — <reason> — `<exact command to run>` -->

## Decisions made by agents

- [M0] Package manager is Bun 1.4.3 (`packageManager` field, `bun.lock`), runtime Node 22 — maintainer decision mid-M0 — DECISIONS D14, D7
- [M0] Toolchain at current majors: TypeScript 7.0 (native `tsc`), Vitest 5, Biome 2.5, Turborepo 2.11, Zod 4 — latest stable at build time; all pass `bun run check` — AGENTS.md §3
- [M0] Internal-package pattern: each workspace exports `./src/index.ts` directly, so dev, tests and the CLI need no build step; the CLI bin runs TS through `tsx`. A bundled build comes with Docker/M10 — ARCHITECTURE §5
- [M0] Schema drift = `z.toJSONSchema` of every schema in `jsonSchemaRegistry` compared to committed `packages/schema/json/*.json` (`bun run schema:write` updates). Registry is empty until M1 — specs/report-schema.md, AGENTS.md §3
- [M0] `aa doctor` exits 1 only when Node (<22) or DuckDB fails; unreachable model providers and services are reported with a fix and exit 0. openai-compatible endpoints (Groq, OpenRouter) are probed only when their key env var is set — specs/interfaces.md §2, AGENTS.md §2.9
- [M0] Docker engine image runs `aa doctor` until `aa serve` exists (M10) — specs/interfaces.md §2
- [runtime-probe] 2026-10-16 — Bun 1.4.3 as runtime for @duckdb/node-api: PASS (duckdb v1.5.6 sum(1..10)=55) — informs whether D7 (Node runtime) can switch to Bun — `bash scripts/check-bun-runtime.sh`
- [M1] Committed JSON Schema lives in `packages/schema/json/*.schema.json` (not `dist/`, which is gitignored) so the drift check has a committed file to compare; generated with `io: "input"` so defaults are optional — specs/report-schema.md (updated)
- [M1] Report v1 gains an additive optional `evidence` block (verbatim source excerpts) so the self-contained HTML can show cited rows and passages offline; `report.metrics` is `MetricDef & { plain, sql }` — specs/report-schema.md §5a (added)
- [M1] Cross-reference integrity (placeholders, ids, citations, free numerals) is a separate `checkReportIntegrity` pass, not Zod refinements, so the JSON Schema stays clean and the verifier (M9) can reuse it — specs/report-schema.md §3–4
- [M1] The golden fixture is generated from the dataset's integer-cent ground truth (`build:golden-report`) and a test asserts the committed file equals a fresh build — AGENTS.md §2.1 (no hand-typed numbers)
- [M1] Fixture metrics are defined over the owner's `Monthly` summary table (`t_monthly`) so citations match the blueprint rows (r4–r5); `Orders` aggregates exactly to it. `refund_rate` is `avg(refund_rate*100)` over that table and marked assumed — blueprint §02, metric-layer.md §1
- [M1] Blueprint figures that aren't spec'd as golden were recomputed with the `impact.v1` formulas instead of copied: excess refunds 814/month (blueprint "about 810"), R1 range 3,995–7,191 = 8,500 × 50–90% × (1 − 6%) (blueprint "4,000–7,500"), R1 check 11,395 = 7,400 + 3,995 (blueprint "11,000"). The spec'd golden numbers match exactly: −17.9%, 108%, 1.2%→3.4% — analysis-library.md §5, §7
- [M1] Currency for coffee-roaster-v1 is USD (blueprint amounts are too small for UZS) — EVALS.md §1
- [M1] Config: roles on `openai-compatible` carry an `endpoint` name; env specs are `provider:model` or `openai-compatible:<endpoint>:<model>`; built-in free presets groq/openrouter/cerebras/github-models — specs/models.md §4 (updated)
- [M1] Both free providers go through `@ai-sdk/openai-compatible` (Ollama via its `/v1` endpoint); structured output uses AI SDK v7 `generateText` + `Output.object`, with our own retry loop feeding validation errors back (max 2 retries) — specs/models.md §1, §5
- [M1] `aa doctor` only attempts the model call when the planner's provider answered its probe, so a machine with no model prints `skipped` and exits 0 — specs/interfaces.md §2, AGENTS.md §2.9
- [M1] HTML uses system font stacks (no web fonts) to stay offline; index keys allowed in the SSR-only report package (static markup, no re-render) — specs/report-schema.md §6

<!-- Format: - [M<N>] <decision> — <why> — <spec reference> -->

## Known gaps carried forward

- [M0] docker-compose images for searxng, docling and ollama use `:latest` — pin versions before M10/M12
- [M0] `aa serve` doesn't exist yet, so the engine container runs `aa doctor` and exits — M10
- [M1] `ModelClient.embed` throws `NOT_AVAILABLE` until the in-process transformers embedder lands — M6 (FakeModel embeds deterministically for tests)
- [M1] Document char offsets in the golden fixture are relative to the authored page/body/notes text (`pageText`, `EMAIL_BODY`, `opsNotesText`); M2 extractors must produce the same text or the fixture spans need re-basing — M2
- [M1] The HTML renderer was checked structurally (happy-dom clicks, offline scan) but not reviewed visually in a real browser — review the rendered `packages/report/out/report.coffee-roaster.html` at the M1 notify gate
