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

## D15. VHS and Playwright for README assets; Astro Starlight docs (2026-10-16)

The README visuals and their checks (docs/DOCS-SITE.md §3) use two free, local, dev-only tools:

- **VHS** (MIT, charmbracelet) records the terminal part of the demo GIF from a committed `.tape`. It needs `ttyd` and `ffmpeg`. Install it with `brew install vhs` or the release binaries. It is never a runtime dependency.
- **Playwright** (Apache-2.0) records the report clip and runs the browser checks (`readme:check:browser`): hero animations under reduced motion, the `<picture>` variant per color scheme, and the citation click. CI installs Chromium in a separate job.

The docs site is Astro Starlight (already in the AGENTS.md §3 stack), deployed to GitHub Pages once the repo is public.

Nothing here runs in the engine, and no paid service is involved.

## D16. Standalone CLI binaries run on Bun's runtime (2026-10-16)

Release tags also attach `aa` binaries built with `bun build --compile` (Linux x64/arm64, macOS arm64, Windows x64) with SHA256 checksums. A compiled binary runs on Bun's runtime, an exception to D7 (Node 22 is the runtime) limited to that artifact; the Node CLI, Docker image, CI and tests are unchanged. Verified on 2026-10-16:

- DuckDB's addon links against its shared library (`libduckdb.so`/`.dylib`/`duckdb.dll`), which `bun build --compile` doesn't carry, so the binary embeds the library, writes it once to a per-version cache folder and loads it before the addon (`apps/cli/src/native-lib.ts`, `scripts/build-binary.ts`).
- The same offline eval gives byte-identical results through the binary and through Node (timings aside).
- The cache folder is named after the `@duckdb/node-api` package version plus platform and architecture (e.g. `duckdb-1.5.6-r.1-linux-x64`).
- `aa serve` in the binary has no viewer at `/` (its page points at a job's `report.html`); the API and MCP work.
- The in-process ONNX embedder doesn't load in the binary (Transformers.js needs the sharp and onnxruntime native libraries), so the binary defaults to the hash embedder and says so; Docker remains the install path for semantic document search.
- Prompts are inlined into `packages/agent/src/prompts.gen.ts` (checked by `bun run prompts:check`) instead of read from disk next to the source.

Each target is built and smoke tested (doctor + a full offline eval) on its own native runner (`.github/workflows/binaries.yml`), on pull requests that touch the build and on every tag.

## D17. Self-hosted site fonts and axe for the site's accessibility checks (2026-10-17)

The product site (apps/docs/DESIGN.md) adds three font packages and one test tool. All are free, run locally, and none touches the engine:

- **Fonts:** `@fontsource-variable/source-serif-4`, `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono`, all under the SIL Open Font License 1.1.
  - Vite bundles the WOFF2 files into the site, so it makes no request to a font CDN (no third-party requests at runtime).
  - The pairing deliberately differs from the sibling pas-agent site (Instrument Sans + JetBrains Mono).
- **`@axe-core/playwright`** (MPL-2.0; axe-core is MPL-2.0 too) is a root dev dependency. The `site-browser` CI job uses it to check WCAG 2 A/AA, light and dark, on every page of the built site.

Both reuse Playwright (D15). No paid service is involved.

## D18. three.js for the landing page's engine machine (2026-10-21)

The landing page's engine machine (apps/docs/DESIGN.md §6, the plan in `docs/plans/site-3d.md`) draws the pipeline in 3D with **three.js** (`three`, MIT), pinned to `0.186.1` as a dependency of `apps/docs` only, with `@types/three` `0.186.0` as a dev dependency:

- It is imported as ES modules (`three`, `three/examples/jsm/controls/OrbitControls.js`), so the bundler keeps only what the machine uses. With the machine's own code it is one lazy chunk of about 140 KB gzip, fetched only when a reader shows intent on **Open the machine** (hover, focus or pointerdown), never with the page.
- Site v4 (PR 2, 2026-10-22) supersedes the loading rule above: the machine is live in its own band, so the chunk is imported on idle after the page's load event once the band is near (a quarter screen away on desktop, a screen on phones), and OrbitControls is no longer used (the camera follows the scroll). The decision to use three is unchanged. Site v5 (the machine's modes, 2026-10-23) brings OrbitControls back for the explore mode only, in the same lazy chunk; the loading rule of site v4 stands.
- It is bundled into the site: no CDN, no third-party request.
- The docs `assets` script also uses it at build time, in Playwright's Chromium, to render the machine's still images from the same scene.

Nothing in the engine uses it, and no paid service is involved. Hand-written WebGL was the alternative: smaller, but the scene, the orbit controls and the picking would be ours to maintain.
