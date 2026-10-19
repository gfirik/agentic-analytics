# Product site and docs (`apps/docs`, Astro Starlight, deployed to GitHub Pages)

The docs are part of the product, not something added at the end. Every stage of the pipeline gets a page that shows how it works visually.

The site has two parts:

- **A landing page** (`src/pages/index.astro`, M13f): a custom page, not the Starlight splash.
- **The docs:** Starlight, fully themed.

They share one design system, `apps/docs/DESIGN.md`. Its tokens live in `src/styles/tokens.css`, and its identity is "an AI analyst you can audit": a cool slate/ink-navy palette, one green accent used only for "verified", Source Serif 4 + IBM Plex Sans + IBM Plex Mono (self-hosted), and ledger motifs (ruled tables, fact-ID chips, check marks).

## 1. Structure

| Section | Pages |
|---|---|
| Landing page (`/`) | Website v2 (M13i, apps/docs/DESIGN.md): the status strip; a centred statement block, then the hero exhibit as its own framed section (M13k: the coffee-roaster report, verified figure by figure as it comes into view, then a guided walkthrough of its key figures, each opening its margin note: scroll-linked on desktop, timed on small screens, a static list under reduced motion or without JS); §1 how it works (the pipeline scene); §2 three proofs; §3 results as they are (model rows and real-data checks, partial runs labelled); §4 quickstart, binaries and the four doors |
| Start | What it is (1-minute read + animated pipeline), Quickstart (Docker / Bun / Ollama / free endpoint), Your first report (coffee-roaster walkthrough), Running on free models (the Models page, listed here since M13f) |
| How it works | Pipeline overview (interactive, ported from `docs/assets/blueprint.html`); Ingest & table detection; Profiling & data quality; Metric layer; Detecting changes; Finding drivers (PVM, contribution, rate/mix, Simpson, DIFF), with worked examples and animated bar breakdowns; Documents lane (RAG: chunking, BM25, vectors, RRF, rerank, with a step-through visual); Web lane & privacy; Explain & causal grades; Decisions & impact ranges; The verifier (V1–V8 with a before/after draft example); Security & prompt injection |
| Learn (M13g) | The beginner path, all on the coffee-roaster example: the big-picture overview (the pipeline animation and a map of every stage with its real in/out); ten stage guides (ingestion & profiling, metric layer, analysis, retrieval, web lane, planner, verifier, report & fact IDs, model router & free providers, security), each with the problem it solves, a step-through diagram, the ideas behind it, a try-it command, repo links and further reading; five tutorials (first file, confirm metrics, documents as evidence, Claude via MCP, evals on your own data); a glossary. Each guide links "Go deeper" to its How it works page |
| Use it | One engine, four doors (overview), CLI, HTTP API (generated from OpenAPI), MCP (Claude Desktop / Cursor setup), Telegram demo, Viewer |
| Reference | Report schema (generated from JSON Schema), Metric YAML, Config, Insight templates list, Decomposers list |
| Quality | Evals: method, datasets, results table (from `evals/RESULTS.md`), how to reproduce |
| Project | Architecture, Decisions, Roadmap, Contributing, Security policy, Changelog |

## 2. Visual components (Astro/React islands)

- **`<Pipeline />`:** the animated pipeline (ported from the blueprint's SVG): files → profile → metric → SQL facts with their ids → document and web evidence → verifier V1–V8 → report with the top-ranked action. It plays the same scene the README GIF is recorded from (`src/components/pipeline-scene.ts`, §3), fed by one real run's data, so readers watch a real run.
- **`<CitationDemo />`:** the click-a-citation, highlight-the-rows interaction from the blueprint.
- **`<Decomposition />`:** a waterfall chart that animates a PVM or contribution split.
- **`<RagStepper />`:** walks a query through BM25, vectors, RRF, rerank and extract, showing ranks changing.
- **`<VerifierDiff />`:** shows a draft report vs the verified report, with dropped and downgraded claims highlighted.
- **Mermaid** for architecture and state diagrams.
- **The hero exhibit** (`components/site/Exhibit.astro`, landing page):
  - It shows the first finding of the real coffee-roaster run, each number followed by its fact-ID chip.
  - It replays its verification as it comes into view, unless reduced motion is on.
  - It walks through its key figures by itself (M13k): the change, its SQL input and sheet rows, the driver, the quoted cause (`walkthrough()` in `scripts/landing-data.ts`, chosen by role from the run's data). Scroll drives the steps from 1100×704 px (a sticky section); smaller screens advance on a timer while the notes are on screen, with Pause, waiting while the reader hovers or focuses inside. Previous, next and replay are always there; reduced motion or no JS shows the steps as a static ruled list.
  - Hovering or focusing a figure opens its margin note: the SQL and parameters (or the function and its inputs), and the cited sheet rows.
  - A chip links to the fact's row in a static fact ledger, so it works without JS.
- **`<Sidenote>` / `<MarginNote>`** (Learn, MDX): Tufte-style notes in the margin column, tap-to-expand under 1000px.
- **Learn components** (`src/components/learn/`): `StageFlow` (in → stage → out, stepped through, final state server-rendered), `Transcript` (a recorded terminal session), `Fact` and `FactLedger` (a figure with its chip, and the page's fact ledger the chips link to), `Claim` (placeholders filled with chips), `LearnMap` (the overview). All read `docs/assets/learn/learn.json`.
- **Accessibility:** every component respects `prefers-reduced-motion` and renders its final state on the server. The site is light only (M13i).
- **Theme:** every component uses the site tokens (`src/styles/tokens.css`). The pipeline scene keeps its own colours for the README GIF; the site re-themes it through its `--pp-*` custom properties, so `pipeline-scene.ts` (hash-checked against the GIFs) is unchanged.

## 3. README visuals

The README is the first thing people see on GitHub. It carries five visuals, and **every asset is generated by a script in `scripts/readme-assets/`**, so none of them can drift from the product. Nothing is hand-edited or hand-exported.

| # | Visual | What it shows | Generated by |
|---|---|---|---|
| 1 | **Animated SVG hero** | Files → three lanes (tables, docs, web) → analyst → verifier → report. | `scripts/readme-assets/hero.ts` writes `docs/assets/readme/hero-light.svg` and `hero-dark.svg` |
| 2 | **Demo GIF** | `aa analyze examples/coffee-roaster --open` in a terminal, then the report opening and a citation click lighting up the source rows. | `scripts/readme-assets/demo.sh`: [VHS](https://github.com/charmbracelet/vhs) records the terminal from a committed `.tape` file, and Playwright records the report clip; the two are joined into `docs/assets/readme/demo.gif` |
| 3 | **Mermaid diagrams** | Architecture (packages and doors) and the pipeline state machine. | Canonical sources are committed `docs/assets/diagrams/architecture.mmd` and `pipeline.mmd`. `scripts/readme-assets/mermaid.ts` injects them between marker comments in README.md and docs/ARCHITECTURE.md (replacing today's hand-written blocks), and the docs site imports the same files, so all three show one diagram |
| 5 | **Pipeline GIF** ("How it works") | One real web-enabled run of `examples/coffee-roaster` (scripted planner, offline web fixture, no LLM): files flow in, profile, the metric definition, SQL facts getting their ids (−17.9%), the wholesale driver, the hotel's email and a labelled web quote, the verifier's V1–V8 table, and the report's top-ranked action. | `apps/docs/scripts/pipeline-data.ts --write` extracts `docs/assets/readme/pipeline.json` from the run's event log, verified report and check table; `scripts/readme-assets/pipeline-gif.ts` screenshots `apps/docs/src/components/pipeline-scene.ts` frame by frame with Playwright and encodes `pipeline-{light,dark}.gif` and the still `pipeline-{light,dark}.png` with ffmpeg. The docs `<Pipeline />` island plays the same scene |
| 4 | **Tables** | A "problems it solves" before/after table, and an eval results table. | `scripts/readme-assets/tables.ts`: the before/after rows come from a committed data file; the eval table is rendered from `evals/RESULTS.md` |

**Hero SVG requirements.**

- Pure SVG with CSS keyframe animation. No JavaScript, no external fonts, and no external requests, because GitHub renders README SVGs as images.
- Light and dark variants served through `<picture>` with `<source media="(prefers-color-scheme: dark)">` and a light `<img>` fallback with alt text.
- The animation is wrapped in `@media (prefers-reduced-motion: no-preference)`. With reduced motion the SVG shows the finished, static state.
- Under 100 KB, sharp at 2× density, and readable at 360 px wide.

**Demo GIF requirements.**

- Recorded with FakeModel or a scripted model run on `examples/coffee-roaster`, so the output is identical on every run. The README caption says so ("scripted, deterministic run"); it must not pass for a live LLM run.
- Under 5 MB, at most 30 s, with no personal paths or hostnames in frame (the `.tape` sets a fixed prompt and working directory).
- Shows the live stage view, the final summary line, the report opening, and one citation click highlighting rows.

**Pipeline GIF requirements.**

- No number on screen is typed by hand; every one comes from the run. Facts of the verified report are shown with their ids; counts (profile, V1–V8, the verification summary, the number of actions) come from the report and the verifier's `verification` table; every quote is a citation the verifier kept, with the email's sender from its parsed headers. The rail is read from the run's event log: which nodes appear, their order, and the engine stages each card's caption names (`railOf` maps stages to nodes).
- Light and dark GIFs through `<picture>` by `prefers-color-scheme`; under `prefers-reduced-motion: reduce` the still PNG of the finished report instead; the `<img>` fallback is the light PNG, with alt text generated from the same data.
- At most 15 s per loop, at most 3 MB each, at least 720 px wide, and readable at 360 px wide: on the 640×480 canvas, body text (sentences, quotes, numbers) is ≥ 22 px and labels (stage names, ids, captions, counts) are ≥ 18 px, a few words per frame. A test enforces the 18 px floor on every frame.

**Tables requirements.**

- Before/after: one row for each of the seven problems in blueprint §04 ("what others leave broken": confidently wrong numbers, spreadsheets treated as text, no way to check a claim, advice with no basis, lanes never meet, data leaves the building, hard to plug in), plus two rows from other sources: the wrong metric definition (PRD §1) and prompt injection (specs/security.md §1). The rows live in a committed `scripts/readme-assets/problems.yaml` with a `source` field per row. Columns are "typical AI analyst" and "agentic-analytics". Each "after" cell names the mechanism and links to its docs page.
- Eval results: the latest `evals/RESULTS.md` table per model, using the docs/EVALS.md §2 metric names exactly (Planted recall@5, Driver accuracy, Number mismatches, Citation precision, Cost / time), with hardware noted. If real-model results are still DEFERRED, the table shows one row labelled "real-model results not yet run" and no numbers. FakeModel smoke results are never shown as model quality (EVALS.md §4: listed honestly).

**Checks.** `bun run readme:assets` regenerates everything. Static checks (`bun run readme:check`) run inside `bun run check`, so the gate and CI always run them. Browser checks (`bun run readme:check:browser`) run as a separate required CI job that installs and caches Playwright browsers. Together they fail when any of these fail:

- **Drift:** the hero SVGs, the README/ARCHITECTURE Mermaid blocks and both tables match a fresh generator run, byte for byte.
- **Hero:** each SVG is under 100 KB, contains no `<script>` and no `http(s)://` references, and every `animation`/`animation-*` declaration is inside `@media (prefers-reduced-motion: no-preference)` (static). A Playwright test (browser job) loads `hero-light.svg` and `hero-dark.svg` with `emulateMedia({ colorScheme, reducedMotion: "reduce" })` and asserts `document.getAnimations().length === 0`; with `reducedMotion: "no-preference"` it asserts that animations run. A second test renders the README `<picture>` block in both color schemes and asserts the matching variant is the one loaded.
- **Pipeline GIF:** `pipeline.json` matches a fresh engine run (a vitest test, numbers to V2's tolerance) and holds −17.9%, the wholesale driver, the hotel email citation and the fact ids; `pipeline-gif.json` records the hash of `pipeline.json`, `pipeline-scene.ts` and the recorder `pipeline-gif.ts` the GIFs were recorded from, and `readme:check` fails when either changed without re-recording, when a GIF or PNG is missing, over 3 MB, over 15 s or narrower than 720 px. The browser job asserts the README `<picture>` picks the right GIF per color scheme and the PNG under reduced motion, and that no frame's text leaves the canvas, in both themes.
- **Demo GIF:** it is not byte-compared, because encoders differ. Instead `docs/assets/readme/demo.gif` exists, is under 5 MB and lasts at most 30 s (frame delays summed). The `.tape` sets a fixed `PS1` and working directory and contains no home path. The Playwright clip runs headless with no browser chrome against a `file://` report, so no URL or hostname is in frame. The citation spec (browser job) runs in check mode against the rendered `examples/coffee-roaster` report and asserts that the cited rows are highlighted.
- **Manual (QA, once per release):** open the README on GitHub in light and dark mode and confirm the hero, Mermaid diagrams and GIF render. Record the result in the release PR.

**Tools.** VHS (MIT; needs `ttyd` and `ffmpeg`) and Playwright (Apache-2.0) are free, local, dev-only tools. M12 adds a DECISIONS.md entry for them before they are installed.

## 4. Site data, files and checks

- **Numbers.**
  - Every number on the landing page comes from generated data, written by `scripts/generate.ts` on each build (gitignored).
  - `landing.json` comes from the same web-enabled run as the hero animation (`pipeline-data.ts` `recordRun()`, via `scripts/landing-data.ts`). The build fails, and `scripts/test/landing-run.test.ts` fails, if its counts or recommendation fact ids disagree with `pipeline.json`, so the page shows one run throughout.
  - `evals.json` holds the suite metrics, computed by the eval runner's own `summarize()` from the latest `evals/results/*.json`, and the real-data checks.
  - The pipeline numbers come from the committed `docs/assets/readme/pipeline.json`.
- **Site files.**
  - `public/favicon.svg`, plus `public/favicon.ico` and `public/og.png` (1200×630). The last two are rendered by `bun run --filter @agentic-analytics/docs assets` with Playwright; the OG headline number is read from `pipeline.json`.
  - `sitemap.xml` is an index pointing at Starlight's `sitemap-0.xml`, which lists the landing page and every docs page.
  - The custom 404 is `src/pages/404.astro` (Starlight's is turned off).
- **Learn data.** `apps/docs/scripts/learn-data.ts --write` records `docs/assets/learn/learn.json` (checked in) from real runs: the web-enabled coffee-roaster run with the planner's tool calls and the workspace tables after each stage; the CLI's own output for each tutorial command (spawned with a clean environment; durations, job ids and temp paths replaced and named); the MCP server through the SDK's in-memory client; the model router on a scripted transport; one injection fixture through a full job and the URL checks. `scripts/test/learn.test.ts` re-records it and fails on drift, checks it is the same run as `pipeline.json`, checks hand-computed values, and checks every repo link on the Learn pages exists and every glossary link has an entry.
- **Commands.** `scripts/test/site-commands.test.ts` (in `bun run check`) extracts every `aa …`, `bun run …` and `./aa-<os>-<arch> …` command from the site's sources and checks it against the citty definitions in `apps/cli/src/main.ts` and the package.json scripts, plus the command of every recorded Learn transcript.
- **Browser** (`bun run site:check:browser`, the `site-browser` CI job, after a site build):
  - no request to any origin but the site's own;
  - axe WCAG 2 A/AA with no violations on every page in the sitemap and on the 404 (light only since M13i);
  - no horizontal scroll at 360 px on every page, and at 1024 px on a Learn page (the margin column's narrowest);
  - light only, even under a dark OS with a stored dark theme;
  - the hero replays its verification once within 2.5 s, and not under reduced motion, also on a 667×375 landscape phone;
  - the walkthrough (M13k): scrolling steps through it on desktop, each step opening its note with the section on screen, plus prev, next and Replay, and a hover mid-walkthrough returning to the step's note; every step's note fits on screen at 1100×704; under 900 px it advances by itself with the notes below, without moving the page, with Pause/Play, a hover hold and manual steps; under reduced motion and without JS it is a static list;
  - no box moves while the fonts arrive late (390 and 1440 px);
  - a margin note opens on hover and focus, beside its figure, and Escape closes it; under 900 px it opens below the exhibit;
  - without JS the page is complete and chips land on the fact ledger;
  - the status strip carries its generated items;
  - Learn sidenotes sit in the margin at 1440 px and expand inline under 1000 px (mouse and keyboard); the epigraph is there, and the TOC is in the margin from 1200 px and in the bar below;
  - the pipeline scene is still until Play; the mobile menu sets aria-expanded and Escape closes it;
  - the favicons, OG image and sitemaps are served, with an absolute og:image;
  - on every Learn page each fact chip lands on a row of that page's ledger, and a stage diagram is complete without JS and marks a step's outputs.
- **Screenshots** for review: `apps/docs/scripts/site-screenshots.ts` writes `docs/assets/site/`. It shoots the landing page, a Learn stage guide and a docs page at 1440 and 390. It also shoots the live walkthrough at each step (`hero-step-<k>-desktop.png` scrolled, `hero-step-<k>-mobile.png` stepped). With `--record` it writes `hero.gif`, recorded as WebM and encoded with ffmpeg: the verification as the exhibit comes into view, the walkthrough scrolled step by step, a hover, then Replay.

## 5. Rules

- Every feature PR from M12 on updates its docs page.
- Code samples are tested (extracted and run in CI where practical).
- Screenshots and GIFs are regenerated from `examples/` by script, so they never drift.
