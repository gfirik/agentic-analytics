# STATE: build ledger

This is the single source of truth for progress between agent sessions. Agents update it inside each milestone PR. Status values: `TODO` · `IN_PROGRESS` · `AWAITING_REVIEW` · `BLOCKED` · `DONE`.

Human gate values:
- `no`: merge and continue.
- `notify`: merge, continue, and message Firdavs to review when convenient.
- `yes`: stop at AWAITING_REVIEW until Firdavs approves. Only M12 is `yes`, because making the repo public and launching is his call.

## Milestones

| Milestone | Status | Human gate | PR | Demo command | Notes |
|---|---|---|---|---|---|
| M0 Foundation | IN_PROGRESS | no | [#1](https://github.com/gfirik/agentic-analytics/pull/1) | `bun install && bun run check`; `bun run aa doctor` | Bun workspaces + Turborepo, CI, doctor, drift check |
| M1 Contracts & golden fixtures | TODO | notify | | | |
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

_None yet._

<!-- Format: - [M<N>] <criterion> — <reason> — `<exact command to run>` -->

## Decisions made by agents

- [M0] Package manager is Bun 1.4.3 (`packageManager` field, `bun.lock`), runtime Node 22 — maintainer decision mid-M0 — DECISIONS D14, D7
- [M0] Toolchain at current majors: TypeScript 7.0 (native `tsc`), Vitest 5, Biome 2.5, Turborepo 2.11, Zod 4 — latest stable at build time; all pass `bun run check` — AGENTS.md §3
- [M0] Internal-package pattern: each workspace exports `./src/index.ts` directly, so dev, tests and the CLI need no build step; the CLI bin runs TS through `tsx`. A bundled build comes with Docker/M10 — ARCHITECTURE §5
- [M0] Schema drift = `z.toJSONSchema` of every schema in `jsonSchemaRegistry` compared to committed `packages/schema/json/*.json` (`bun run schema:write` updates). Registry is empty until M1 — specs/report-schema.md, AGENTS.md §3
- [M0] `aa doctor` exits 1 only when Node (<22) or DuckDB fails; unreachable model providers and services are reported with a fix and exit 0. openai-compatible endpoints (Groq, OpenRouter) are probed only when their key env var is set — specs/interfaces.md §2, AGENTS.md §2.9
- [M0] Docker engine image runs `aa doctor` until `aa serve` exists (M10) — specs/interfaces.md §2
- [runtime-probe] 2026-10-16 — Bun 1.4.3 as runtime for @duckdb/node-api: PASS (duckdb v1.5.6 sum(1..10)=55) — informs whether D7 (Node runtime) can switch to Bun — `bash scripts/check-bun-runtime.sh`

<!-- Format: - [M<N>] <decision> — <why> — <spec reference> -->

## Known gaps carried forward

- [M0] `aa doctor` probes a hardcoded list of free OpenAI-compatible endpoints (Groq, OpenRouter) instead of the provider config in specs/models.md §4 — switch to the config loader when M1 adds it
- [M0] docker-compose images for searxng, docling and ollama use `:latest` — pin versions before M10/M12
- [M0] `aa serve` doesn't exist yet, so the engine container runs `aa doctor` and exits — M10
