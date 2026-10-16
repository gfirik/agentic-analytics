# Architecture decisions

These are short records of why things are the way they are. To change one, add a new entry that supersedes it. Don't edit history.

## D1. TypeScript core, no Python service (2026-10-15)

The engine is TypeScript on Node 22, which is the maintainer's strength and stands out in a Python-heavy space. Statistics (baselines, MAD bands, trend tests), entity matching (DuckDB string similarity) and reranking (transformers.js ONNX) are all done in TypeScript or SQL.

The only non-TypeScript piece is the optional prebuilt `docling-serve` container for hard PDFs and scans. Nobody on the project writes Python.

**Revisit if:** CausalImpact-class analysis is needed. That would be a small Python stats service, after v0.1.

## D2. DuckDB for everything (2026-10-15)

One DuckDB file per job holds the tables (SQL), full-text search and vectors. No Postgres, vector DB or Redis.

- Exact vector search is fast enough at job scale, and the VSS index is skipped because it is experimental for persisted DBs.
- One file per job gives isolation and easy deletion.

## D3. No LangChain, LlamaIndex or LangGraph (2026-10-15)

The pipeline is a fixed ladder, which an explicit state machine models perfectly. Frameworks would hide exactly what this project exists to show (retrieval, tool loops, verification), and they add churn and weight.

**Revisit if:** the flow becomes dynamic multi-agent branching.

## D4. Vercel AI SDK behind our own ModelClient (2026-10-15)

The AI SDK gives provider-neutral calls, Zod-validated structured output with retries, tool loops and streaming. It is Apache-2.0 and runs anywhere. TanStack AI was the alternative, but it has fewer providers.

The `ModelClient` wrapper keeps the engine independent of the SDK, and providers are always configured explicitly (never the default gateway).

## D5. Free and local first; paid providers after v0.1 (2026-10-15)

Providers until M13 are `ollama` and `openai-compatible` only, which covers the free endpoints. Development, CI and evals cost $0.

Model choice is configuration, not architecture. The default and supported list come from eval scores at M11.

## D6. Hono, not NestJS, in the engine (2026-10-15)

The engine is a set of plain packages with thin adapters. NestJS would couple the core to an HTTP framework and make the CLI and MCP boot a web app. NestJS is reserved for the future hosted product, which will import the engine packages.

## D7. Node runtime in Docker; code stays runtime-agnostic (2026-10-15)

DuckDB's native Node addon is the heart of the system, and Bun's native-addon compatibility isn't proven for it. The code uses web-standard APIs, so switching to Bun later is a Dockerfile change once it's verified. Bun may be used as a local tool.

## D8. Not Rust (2026-10-15)

The heavy computation is already native (DuckDB in C++) or external (model inference). Our code orchestrates I/O, so Rust would add cost and cut the contributor pool with little speed gain.

## D9. Deterministic analysis, model as narrator (2026-10-15)

Detection, decomposition and impact math are deterministic library code. The model chooses among computed facts and explains them, and every number references a fact ID.

This is the core answer to the documented failures of AI analysts: wrong arithmetic, wrong quantities, and spurious drivers.

## D10. Metric layer with confirmation (2026-10-15)

Definitions are drafted, then confirmed by the user, and anything unconfirmed is carried as an assumption. This targets the "correctly computed wrong quantity" failure mode (Argo-Bench 2026). The format follows Apache Ossie concepts.

## D11. Dual-LLM quarantine for untrusted text (2026-10-15)

Only a tool-less extractor reads documents and web pages, and the planner sees typed extracts. This blocks prompt injection architecturally, and the tests prove it even with a model scripted to obey injections.

## D12. Apache-2.0 license (2026-10-15)

It gives maximum adoption, a patent grant, and compatibility with a future hosted product. The license is chosen once, at launch, and is not changed later.

## D13. Repo name `agentic-analytics` (2026-10-15)

The repo name is self-explanatory and uses the 2026 category term (Gartner), with an almost empty GitHub topic we can own. The product or brand name is decided before launch.

## D14. Bun is the package manager; Node 22 stays the runtime (2026-10-16)

Bun is the package manager (maintainer preference, faster installs). The repo uses Bun workspaces with `bun.lock`; scripts run with `bun run` and one-off tools with `bunx`. Turborepo and Vitest stay.

The runtime stays Node 22 until DuckDB is verified under Bun (see D7). `scripts/check-bun-runtime.sh` runs a DuckDB query under Bun and records the result in `docs/progress/STATE.md`, so the switch can be decided on evidence.

**Supersedes:** the "pnpm workspaces" row of the AGENTS.md stack table.

## D16. Standalone CLI binaries run on Bun's runtime (2026-10-16)

Release tags also attach `aa` binaries built with `bun build --compile` (Linux x64/arm64, macOS arm64, Windows x64) with SHA256 checksums. A compiled binary runs on Bun's runtime, an exception to D7 (Node 22 is the runtime) limited to that artifact; the Node CLI, Docker image, CI and tests are unchanged. Verified on 2026-10-16:

- DuckDB's addon links against its shared library (`libduckdb.so`/`.dylib`/`duckdb.dll`), which `bun build --compile` doesn't carry, so the binary embeds the library, writes it once to a per-version cache folder and loads it before the addon (`apps/cli/src/native-lib.ts`, `scripts/build-binary.ts`).
- The same offline eval gives byte-identical results through the binary and through Node (timings aside).
- The in-process ONNX embedder doesn't load in the binary (Transformers.js needs the sharp and onnxruntime native libraries), so the binary defaults to the hash embedder and says so; Docker remains the install path for semantic document search.
- Prompts are inlined into `packages/agent/src/prompts.gen.ts` (checked by `bun run prompts:check`) instead of read from disk next to the source.

Each target is built and smoke tested (doctor + a full offline eval) on its own native runner (`.github/workflows/binaries.yml`), on pull requests that touch the build and on every tag.

## D15. VHS and Playwright for README assets; Astro Starlight docs (2026-10-16)

The README visuals and their checks (docs/DOCS-SITE.md §3) use two free, local, dev-only tools:

- **VHS** (MIT, charmbracelet) records the terminal part of the demo GIF from a committed `.tape`. It needs `ttyd` and `ffmpeg`. Install it with `brew install vhs` or the release binaries. It is never a runtime dependency.
- **Playwright** (Apache-2.0) records the report clip and runs the browser checks (`readme:check:browser`): hero animations under reduced motion, the `<picture>` variant per color scheme, and the citation click. CI installs Chromium in a separate job.

The docs site is Astro Starlight (already in the AGENTS.md §3 stack), deployed to GitHub Pages once the repo is public.

Nothing here runs in the engine, and no paid service is involved.
