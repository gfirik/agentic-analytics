# Code-quality review, October 2026

A read of the whole codebase after M14a, written so a new reader can learn the code package by package. Each package section says what the package does, how data flows in and out, its main entry points, and its top issues, ranked by impact with `file:line` and a suggested fix. The fixes follow in small PRs, in the order of §3 below.

## 1. How this was done

- **The code read:** `origin/main` at 6d5798b (after M14a, #43–#50). The `apps/docs/src` components were left out: the site is design-frozen, and the 3D engine-machine PR is changing it.
- **Who read what:** seven read-only reviews, one per group of related packages. Each read the package README, every `src/` and `test/` file, and the specs it implements. Nothing was run except light checks (grep, `node -e` on a single function, a DuckDB one-liner).
- **Checks on the claims:**
  - every row points at a line that was opened and read;
  - dead-code claims were grepped across the whole repo, tests and scripts included;
  - `knip` was used only as a lead (it flags script entry points and test-only exports as unused, so its raw list is noisy).
  
  The headline findings (§2, rows 1, 3, 9, 10, 11 and 13) were re-checked by hand against the code; the rest rest on the reviews' own reading.
- **Ranking:** by real impact. A breach of an AGENTS.md non-negotiable or a crash outranks a silent wrong number, which outranks a missing test, which outranks duplication, dead code and naming.
- **Kinds:** correctness risk, rule risk (an AGENTS.md non-negotiable), missing test, duplication, dead code, unclear name, complexity, docs drift.

**143 issues** in 24 sections. About half are correctness or rule risks. The rest are tests, duplication, naming and docs drift.

## 2. The top issues across the codebase

| # | Package | What's wrong | Where | Kind |
|---|---|---|---|---|
| 1 | agent / core | **Quarantine leak (rule 5).** Text from table cells reaches the planner prompt unscreened: dimension members appear in fact labels (`revenue[customer=<cell>]`), decomposition keys and `member.value`, and a quarantined table's facts and insights aren't filtered out | `packages/agent/src/factsheet.ts:35`, `packages/core/src/job.ts:430` | rule risk |
| 2 | agent | The extractor's own prose fields (`what`, `claim`, `actor`, `topic`) reach the planner without the screen | `packages/agent/src/extractor.ts:90-118` | rule risk |
| 3 | schema | **The free-numeral guard is too lax (rule 1/2).** Any number from 1900 to 2099 counts as a year; "top 3 may" counts as a date; non-ASCII digits are never seen. So "We lost 2000 customers" passes | `packages/schema/src/integrity.ts:25` | rule risk |
| 4 | verify | V1's claim rules (quoted digits, the "fell {{N}}" sign, "more than the whole") don't run on the headline, titles, actions or `not_advised` | `packages/verify/src/verify.ts:430` | rule risk |
| 5 | metrics / cli | The metric-draft screen has gaps: a withheld label still goes out as its snake_case name, sheet names are never screened, and `aa metrics` calls the model with no screen at all | `packages/metrics/src/digest.ts:64`, `apps/cli/src/metrics.ts:71` | rule risk |
| 6 | retrieval | Quarantined documents are still indexed and returned. They take top-8 slots from real evidence | `packages/retrieval/src/retrieval.sql.ts:6-11` | correctness risk |
| 7 | agent | `privateTerms` misses names that appear only in email headers or extract actors, so the planner could put them in a web query | `packages/agent/src/web.ts:26-45` | rule risk |
| 8 | scripts | `notify.sh` puts the Telegram bot token on curl's command line, where `ps` shows it to other local users | `scripts/notify.sh:22` | rule risk |
| 9 | ingest / profile | **Crash on big files:** `Math.max(...rows)` overflows the stack above about 150k rows, so a large CSV reads as "unreadable" | `packages/ingest/src/regions.ts:78`, `packages/profile/src/normalize.ts:173` | correctness risk |
| 10 | web | A malformed `%zz` escape in any search result or redirect throws a `URIError` that fails the whole EXPLAIN stage | `packages/web/src/fetch.ts:75` | correctness risk |
| 11 | core | `aa run --resume` after an INGEST or PROFILE failure wipes the job database, stored options included, so the resume command the CLI prints fails with `BAD_OPTIONS` | `packages/core/src/job.ts:220-231` | correctness risk |
| 12 | server | An unhandled SSE subscribe rejection (a DELETE racing `GET /events`) can crash the server. Oversized or wrong-type uploads get a 500, not a 413 or 415. `/ask` with no body skips validation | `apps/server/src/app.ts:233`, `:99`, `:312` | correctness risk |
| 13 | analysis | **Missing periods:** a period with no data drops out of the series, and every time-series test works by array position. So "previous period" can compare March with January without knowing it | `packages/analysis/src/runner.ts:119` | correctness risk |
| 14 | analysis | `pctChange` on a base of 0 gives `NaN`, and a negative base flips the sign (profit −10 → −5 shows as −50%). `FactBook.calc` accepts non-finite values. Missing fact ids silently become `""` | `packages/analysis/src/templates.ts:43`, `runner.ts:361` | correctness risk |
| 15 | evals | **The scores can pass by accident:** citation precision and definition adherence copy the verifier's own counters (shipped reports score 100% by construction); a bar with no data reads as a pass; planted-event matching ignores direction | `evals/runner/src/score.ts:276`, `:115`; `apps/cli/src/main.ts:485` | correctness risk |
| 16 | core | Any follow-up question containing a digit ("drop 10%", "Q2") becomes a scratch finding's title, so `ask` fails as UNVERIFIABLE | `packages/core/src/followup.ts:76` | correctness risk |
| 17 | models | The real AI-SDK client drops tool errors; only FakeModel reports them. Production never logs a failed tool call, and tests can't show the agent's behaviour after one | `packages/models/src/ai-sdk.ts:198-201` | correctness risk |
| 18 | profile | A time like "24:00" passes date parsing and breaks the DuckDB load. A two-digit year 98 becomes 2098 | `packages/profile/src/dates.ts:45`, `:108` | correctness risk |
| 19 | verify | V4 checks words per fact, not per claim; V6 keeps causal wording in the headline if any finding has a document behind it; a judge error fails VERIFY | `packages/verify/src/verify.ts:265`, `:431`, `:313` | correctness risk |
| 20 | mcp / telegram | The MCP file cap is per path with no byte limit, and raw error messages go to HTTP callers. The Telegram bot freezes for every chat while one job runs | `apps/mcp/src/server.ts:66`, `:58`; `apps/telegram/src/bot.ts:70` | correctness risk |

## 3. The fix plan: small PRs, highest impact first

Each PR fixes one theme, adds a test that fails before the fix, and goes through the usual gate, reviewer, QA and Telegram.

1. **Quarantine, part 1:** screened tables' cells out of the planner's view. The fact sheet, explain, DECIDE and ask filter out quarantined tables' facts and insights, and dimension members pass through the screen. Plus an injection fixture with the payload in a cell (rows 1, 2).
2. **Quarantine, part 2:** the metric-draft screen gaps, `aa metrics`, and quarantined documents in retrieval (rows 5, 6).
3. **Numerals:** a stricter `findFreeNumerals`, and V1's claim rules applied to the headline, titles, actions and `not_advised` (rows 3, 4).
4. **Leaks:** `privateTerms` coverage and the Telegram token off the command line (rows 7, 8).
5. **Crashes:** the ingest and profile spreads, `decodeURIComponent`, the "24:00" time and CRLF Markdown (rows 9, 10, 18).
6. **Core:** resume, the follow-up title, and the subscribe race (rows 11, 16).
7. **Server and doors:** server errors and validation, the SSE rejection and a CSP; the MCP caps and error messages; Telegram concurrency, albums and memory; the viewer's error states (rows 12, 20).
8. **Analysis numbers:** explicit missing periods, the `pctChange` base, non-finite and missing facts as errors (rows 13, 14).
9. **Evals:** scoring that measures what EVALS.md says, so bars can't pass by accident (row 15). This one is in the code-quality pass because M14's accuracy program builds on it.
10. **Verify and models:** V4 per claim, the V6 headline, judge errors, and tool errors in the real client (rows 17, 19).
11. **The rest, by package:** the remaining correctness rows (two-digit years, retrieval dates and tabs, `describeExpr` parentheses, `would_change`, web charset, the report's External badge and negative bars, config parsing, the eval logs).
12. **Cleanup:** dead code, duplication, names and docs drift, in a few PRs grouped by package.

## 4. Packages, in pipeline order

- `packages/schema`
- `packages/store`
- `packages/models`
- `packages/ingest`
- `packages/profile`
- `packages/metrics`
- `packages/analysis`
- `packages/agent`
- `packages/retrieval`
- `packages/web`
- `packages/verify`
- `packages/report`
- `packages/core`
- `apps/cli`
- `apps/server`
- `apps/mcp`
- `apps/telegram`
- `apps/viewer`
- `evals/runner`
- `evals/generator`
- `evals/datasets`
- `evals/real`
- `scripts/`
- `apps/docs/scripts`

### `packages/schema` — the shared contracts (Zod schemas) for the report, metrics, config and events

**What it does.** This package defines the shapes that every other package agrees on. It uses Zod, a library that both describes a shape and checks data against it at run time. The shapes are report v1, the metric YAML, the config file and the job events. It also holds `checkReportIntegrity`, which checks the cross-references Zod can't express: every `{{N12}}` placeholder names a real fact, every citation names a real source, and no model-written text holds a "free numeral" (a digit that isn't a placeholder). It renders each schema to JSON Schema so the committed `json/` files can be checked for drift. It reads no files and runs no SQL, and it never computes a number.

**Data in → out.**
- In: unknown JSON (a draft or final report) from `packages/core/src/job.ts` and `packages/verify/src/verify.ts`. YAML parsed by callers for `MetricFile` and `Config`. Model text strings handed to `findFreeNumerals` / `placeholders` by `packages/agent/src/{draft,explain,decide,summary,ask}.ts` and `packages/verify/src/verify.ts:218`.
- Out: typed values or a list of `{ path, message }` issues (`packages/schema/src/validate.ts:4`). JSON Schema file bodies for `scripts/schema-drift.ts`.
- Side effects: none in `src/`. `scripts/validate.ts` reads the report files named on the command line.

**Main entry points.**
- `validateReport` (`packages/schema/src/validate.ts:7`): Zod shape check first, then the integrity rules.
- `checkReportIntegrity` (`packages/schema/src/integrity.ts:39`): the cross-reference and no-free-numerals rules (report-schema §3–4).
- `findFreeNumerals` (`packages/schema/src/integrity.ts:33`): the deterministic guard that keeps raw numbers out of model text. The agent and the verifier both rely on it.
- `Report` (`packages/schema/src/report.ts:161`), `MetricFile` (`packages/schema/src/metric.ts:50`), `Config` (`packages/schema/src/config.ts:48`), `JobEvent` (`packages/schema/src/events.ts:22`): the contracts themselves.
- `jsonSchemaRegistry` (`packages/schema/src/registry.ts:12`) with `generateJsonSchemas` / `compareSchemas` (`packages/schema/src/drift.ts:15`, `:26`): the drift check.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | rule risk | `packages/schema/src/integrity.ts:25` (also `:23`, `:27`, `:36`) | The "dates" exemption is too wide, so model-made numbers get past the free-numeral guard (rule 2.1). I ran it. `"We lost 2000 customers"`, `"Revenue was 1999 in April"`, `"The top 3 may churn"` and `"Sales fell ٣٠٪"` all return `[]`. Line 25 treats any 1900–2099 number as a year. Line 23 reads "3 may" as a date. Line 36 uses `\d` without the `u` flag, so non-ASCII digits (Arabic-Indic and similar) are never seen. Line 27 also exempts anything in quotes. For claims, `packages/verify/src/verify.ts:223` checks quoted digits against the sources, but nothing does that for the other text fields this function guards (risk, action, questions, data-quality descriptions). The only test is two happy-path cases (`packages/schema/test/report.test.ts:132-135`). | Accept a bare year only when it sits inside the report's period or next to a month or "in/FY", and accept "N month" only with an unambiguous month word ("May" in title case, or a full month name followed by a year). Match `\p{Nd}` with the `u` flag. Add a table of adversarial cases to the test. |
| 2 | correctness risk | `packages/schema/src/report.ts:35` (and `:24`) | `Source.locator` is a plain union that isn't tied to `kind`. A `kind: "web"` source with a `TableLocator`, or a `kind: "table"` source with a `DocLocator`, passes both Zod and integrity. A `DocLocator` with `char_end < char_start` also passes. The renderer and the verifier then trust a provenance pointer that can't point at anything. | Add a refine (or a discriminated union keyed by `kind`) that pairs table↔TableLocator, document/email↔DocLocator, web↔WebLocator, and checks `char_end >= char_start`. |
| 3 | duplication | `packages/schema/src/report.ts:47`, `:159`, `:169` | The same enums are written out more than once. `FactUnit` repeats `MetricUnit` (`metric.ts:7`). The report's `period.grain` repeats `Grain` (`metric.ts:8`). `ModelRole` repeats the inline role enum in `events.ts:32`, and `packages/models/src/types.ts:5` keeps its own `Role` subset. Adding a unit or a grain in one place silently misses the others. | Reuse the one exported enum everywhere (`FactUnit = MetricUnit`, `grain: Grain`, `role: ModelRole`). Derive the models `Role` from `ModelRole.extract([...])`. |
| 4 | complexity | `packages/schema/src/integrity.ts:89-94` | `f.drivers` is walked twice: once with `forEach` for the fact refs (line 89) and once with `entries()` for the label text (line 94). The two loops use different styles, and they're easy to update out of step. | Merge them into one loop over `f.drivers ?? []` that checks both facts and the label. |
| 5 | correctness risk | `packages/schema/scripts/validate.ts:7` | `JSON.parse` isn't guarded. One malformed file crashes the script with a stack trace, and the files after it are never checked. That defeats the `✗ file` report format. | Catch the parse error per file, print it as a `✗` line, count it as failed and continue. |

**Fine as it is.** The drift check (`drift.ts`) is small, pure and well tested. `validateReport`'s two-stage shape then integrity design is clear. Every integrity rule returns a precise path, which makes failures easy to read.

### `packages/store` — the per-job DuckDB workspace: open, migrate, parameterized SQL, bulk load

**What it does.** Each job gets one DuckDB database file. DuckDB is an embedded SQL database, much like SQLite but built for analytics. `Workspace.open` creates or opens that file and applies any schema migrations it hasn't run yet. Migrations are append-only, numbered table-creation steps. The `sql` tagged template turns every `${value}` into a numbered `$n` parameter, so data never becomes SQL text. Table and column names go through `ident()`, which accepts only lower snake_case. `loadJob` writes the ingested files, sources, one typed `t_<id>` table per detected table, and the quality issues. It deliberately knows nothing about metrics, facts or analysis. Those packages write their own rows through the same `Workspace`.

**Data in → out.**
- In: `LoadInput` (`packages/store/src/types.ts:91`) built by `packages/profile/src/job.ts`. `Sql` objects from every package that queries the workspace (analysis, metrics, core, retrieval, verify).
- Out: rows as plain objects (`Workspace.all`, `packages/store/src/workspace.ts:36`), with BIGINT turned into a number when it is safe and dates into ISO strings. Writes go to the DuckDB file.
- Side effects: creates and writes the DuckDB file (or an in-memory database). `duckdbVersion` opens a throwaway in-memory instance.

**Main entry points.**
- `Workspace.open` (`packages/store/src/workspace.ts:19`): opens the file and runs pending migrations.
- `sql` / `ident` / `idents` / `fragment` (`packages/store/src/sql.ts:41`, `:24`, `:30`, `:35`): the only way SQL is built.
- `loadJob` / `loadTable` / `insertIssues` (`packages/store/src/load.ts:9`, `:24`, `:46`): write ingested data.
- `MIGRATIONS` (`packages/store/src/migrations.sql.ts:10`): the workspace schema, versions 1–5.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/store/src/workspace.ts:19-23` (and `:95`) | If `migrate()` throws (a bad or newer workspace file), `open` rethrows without closing the `DuckDBInstance` and connection it just made. The process keeps holding the file until garbage collection, so a retry or a `--resume` in the same process can hit a lock. Separately, the `ROLLBACK` at line 95 can itself throw, for example when `BEGIN` failed. That error then replaces the real migration error. | Wrap `migrate()` in try/catch inside `open` and close the connection and instance before rethrowing. Guard the `ROLLBACK` so a failure there doesn't hide the original error. |
| 2 | dead code | `packages/store/src/load.ts:55` (exported at `packages/store/src/index.ts:2`) | `dataColumns` isn't used anywhere in the repo (I grepped packages, apps, scripts and evals, tests included). At the same time, the README's API table lists only `loadJob`, while `loadTable` and `insertIssues` are used (`packages/profile/src/job.ts:105`, `packages/metrics/test/*.test.ts`). | Delete `dataColumns`, and add `loadTable` and `insertIssues` to the README table. |
| 3 | missing test | `packages/store/test/store.test.ts:65-83` | The "creates every ARCHITECTURE §3 table" test lists only the v1 tables. It never checks `table_columns`, `retrieval_meta`, `job_stages`, `job_meta` or `quarantine` (migrations v1/3/4/5). A later migration that broke one of them would still pass. `docs/ARCHITECTURE.md` §3 also leaves out `table_columns`. | Build the expected list from every `CREATE TABLE` in `MIGRATIONS` (or extend the literal list), and add `table_columns` to ARCHITECTURE §3. |
| 4 | docs drift | `packages/store/src/workspace.ts:50` | The comment says the appender's values "are cast by DuckDB from their text form". In fact numbers go in through `appendDouble` (line 58) for every column type, including BIGINT (`integer`) columns. DuckDB then casts the double, so a non-integer that reached an `integer` column would be rounded silently instead of rejected. | Fix the comment. Optionally append integers with `appendBigInt` when the target column is BIGINT, or assert `Number.isInteger` in `loadTable`. |
| 5 | duplication | `packages/store/src/workspace.ts:31` and `:42` | `run` and `all` build the same `StoreError("QUERY", …\n  in: …)` message by hand. | Pull it into one small `queryError(err, q)` helper. |
| 6 | unclear name | `packages/store/src/migrations.sql.ts:21` (written at `packages/store/src/load.ts:18`) | `sources.section` holds the heading path as a `VARCHAR[]`, while `chunks` calls the same thing `heading_path` (`migrations.sql.ts:46`) and the report's `DocLocator.section` is one string. A reader expects a single section name. | Leave shipped migrations alone, but document the column in ARCHITECTURE §3, or alias it as `heading_path` where it is read. |

**Fine as it is.** The `sql` tagged template and `ident` check are a clean and well-tested barrier against SQL injection, and fragment renumbering works. Keeping migrations append-only, with one transaction per version, is the right shape.

### `packages/models` (including `src/testing`) — the one door to language models: `ModelClient`, routing, retries, usage, and `FakeModel`

**What it does.** This package hides every language model behind one small `ModelClient` interface with three methods: `generateObject` (a JSON answer checked against a Zod schema), `generateWithTools` (a loop where the model may call fixed tools) and `embed`. The real client (`ai-sdk.ts`) is the only file that imports the Vercel AI SDK. Both free providers (Ollama and OpenAI-compatible endpoints) go through the same OpenAI-style HTTP layer (`fetch.ts`). That layer retries rate limits, strips `reasoning_content`, caches answers, logs every call and masks secrets. A `Router` spreads one model across several providers and never switches to a different model. `FakeModel` gives scripted answers so tests never touch the network. The package does no embeddings itself (they are injected from `retrieval`) and has no paid providers.

**Data in → out.**
- In: a `Config` from `resolveModelConfig(env, file)` (`packages/models/src/config.ts:119`), called by `apps/cli/src/main.ts`. `GenerateObjectArgs` / `GenerateWithToolsArgs` (`packages/models/src/types.ts:43`, `:57`) from `packages/agent`, `metrics`, `verify` and `web`. A JSONL call log text for `parseCallLog` (`packages/models/src/usage.ts:103`) from `apps/cli/src/usage.ts`.
- Out: validated objects, tool steps and `Usage`. `CallRecord`s through `ProviderDeps.onCall` (the CLI appends them to `data/logs/model-calls.jsonl`). Usage summaries for `aa usage`.
- Side effects: HTTP to the configured endpoints (real client only). `fileCache` reads and writes `dir/<2 hex>/<key>.json`. `FakeModel` has none.

**Main entry points.**
- `createModelClient` (`packages/models/src/ai-sdk.ts:95`): the real `ModelClient` over the AI SDK.
- `providerFetch` (`packages/models/src/fetch.ts:138`): the HTTP wrapper (429 waits, OTPM re-send, cache, call records, masking).
- `Router.run` (`packages/models/src/router.ts:156`): same-model routing across providers with a total wait budget.
- `resolveModelConfig` (`packages/models/src/config.ts:119`): defaults < file < env, presets, same-model check.
- `FakeModel` (`packages/models/src/testing/fake-model.ts:75`): scripted test double that runs the real tools.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/models/src/ai-sdk.ts:198-201` (vs `packages/models/src/testing/fake-model.ts:120`, `:125`, `:128`) | The real client builds `ToolCallRecord`s only from `s.toolResults`. In AI SDK 7.0.142 that getter keeps only `"tool-result"` parts (`node_modules/.bun/ai@7.0.142…/dist/index.js:4670`), so a tool that throws, or gets invalid input, becomes a `"tool-error"` part that is dropped: no `output` and no `error`. `FakeModel` does the opposite. It sets `error` for unknown tools and bad input, and a throwing `execute` fails the whole call (line 128) where the SDK would feed the error back to the model. As a result, `packages/agent/src/explain.ts:205-209` ("tool call failed" warnings) fires in tests but never in production, and tests can't show how the agent behaves after a tool error. | Map `"tool-error"` parts from `s.content` into `ToolCallRecord.error` in `ai-sdk.ts`. Make `FakeModel` catch `execute` errors into `error` the way the SDK does. Add an ai-sdk test with a throwing tool. |
| 2 | docs drift | `packages/models/src/ai-sdk.ts:102` (vs `packages/models/README.md:42`, `packages/models/src/fetch.ts:139-140`) | The README says "A whole call is bounded at 20× the timeout". The code bounds it at `requests × (timeout + 4 × 90 s)`, which is about 4× at the default 120 s. `callCap(1)` for `generateObject` also doesn't cover what `providerFetch` may do inside one call: up to 6 requests (README:41), plus 2 network retries, plus the router's pause. A slow answer after rate-limit waits can therefore be aborted as `TIMEOUT` partway through a legitimate retry. The `4` and `90_000` copy `providerFetch`'s defaults by hand. | Export the retry and wait defaults from `fetch.ts` and compute the cap from them, including the extra requests. Then fix the README sentence to state the real bound. |
| 3 | dead code | `packages/models/src/profiles.ts:11` | `MODEL_PROFILES` has been an empty array since M1, so `profileFor` always returns `undefined`. The CLI's automatic small-model switch (`apps/cli/src/main.ts:144`, `:633`, via `profileFor` at `:117` and `:598`) therefore never fires, though `docs/specs/models.md:64` says the profiles "are filled in from eval results". The CLI also writes out `describeRoleModel` (`packages/models/src/config.ts:165`) twice by hand to build the id. | Either fill in the measured profiles (e.g. the Groq qwen model used with `--small-model`) or remove the table and say in the spec that small-model mode is a flag only. In the CLI, use `describeRoleModel`. |
| 4 | correctness risk | `packages/models/src/config.ts:127` | `MODEL_TIMEOUT_MS="2m"` or `"abc"` gives `NaN`, which is falsy, so line 136 drops it and the 120 s default is used with no error. `"0"` is ignored the same way. A user who mistypes the env var gets no hint. | Pass the parsed number through even when it is `NaN` or 0, so `Config`'s `int().positive()` rejects it with a CONFIG error that names the variable. |
| 5 | correctness risk | `packages/models/src/config.ts:144-158` (schema at `packages/schema/src/config.ts:5`) | `ProviderId` allows `transformers` for every role, and `resolveModelConfig` doesn't refuse `PLANNER_MODEL=transformers:x`. The mistake surfaces only at the first model call (`ai-sdk.ts:92`, "can't serve a language-model role"), deep inside a job. | In the post-parse loop, reject `transformers` for planner, extractor and judge, and reject anything but `transformers`/`ollama` for the embedder, with a CONFIG error. |
| 6 | duplication | `packages/models/src/router.ts:278-284` | `rateLimitedWait` reads only the `retry-after` header and falls back to 60 s. `retryAfterMs` (`packages/models/src/fetch.ts:117`) already handles the header and the body's "try again in 24.7s". After the transport gives up on a 429 that carried only the body hint, the router blocks the route for a guessed 60 s. | Reuse `retryAfterMs` (or a shared parser) in `rateLimitedWait`, passing the error's response body as well. |
| 7 | unclear name | `packages/models/src/usage.ts:159-168` | The JSDoc that describes `dailyUsage` sits above `realDay`, and `realDay` has its own JSDoc right under it. Editors therefore show the wrong text for `realDay`, and `dailyUsage` (line 170) shows none. | Move the `dailyUsage` comment down to sit directly above `export function dailyUsage`. |

**Fine as it is.** `fetch.ts`'s 429 and OTPM handling, its caching only of complete answers (`cacheable`), and its secret masking are careful, well commented and heavily tested (`fetch.test.ts`, `router.test.ts`). The same-model rule (config check plus router) and the conservative, calibrated token estimate in `budget.ts` are sound and shouldn't be touched.

### `packages/ingest` — files in, raw tables and document sections out, with provenance

**What it does.** It is the INGEST stage. It takes the files a user uploads and turns them into two things: "tables" (rectangles of cells found inside spreadsheets and CSVs) and "sections" (pieces of text from PDFs, Word files, emails, Markdown and plain text). First it does intake for each file: it works out the real file type from its first bytes ("magic bytes"), takes a sha256 fingerprint to skip duplicates, and enforces size limits. Then it parses each file. Spreadsheet cells keep their type, formula text and sheet row, so every number can be traced back to a cell. Nothing is fatal: a bad file becomes an "issue" and the job goes on. It deliberately does NOT clean or type values ("1 234,56" stays text for `profile`), never evaluates formulas, never touches DuckDB, and only talks to the network through the optional Docling client.

**Data in → out.**
- In: `InputFile[]` (`{ name, bytes }`, `src/types.ts:5`) plus `IngestOptions` (limits, optional `DoclingClient`, `src/ingest.ts:34`), from `core`'s job runner and the CLI.
- Out: `IngestResult` (`src/types.ts:109`): `files`, `tables` (`TableRegion`, with sheet, A1 range and `_row` per row), `documents` (sections with page, heading path and character offsets), `documents_meta` (the full text the offsets point into, plus email headers) and `issues`. `profile.profileJob` consumes it.
- Side effects: none, except an HTTP POST to docling-serve when a `DoclingClient` is passed (`src/docs/docling.ts:23`).

**Main entry points.**
- `ingest` (`src/ingest.ts:44`): intake loop, limits, dedupe, per-type dispatch, email attachments re-queued.
- `detectTables` (`src/regions.ts:89`): finds table regions in a cell grid (titles, notes, merged and multi-row headers, totals, side-by-side tables, transposed tables pivoted to long form).
- `readWorkbookGrids` (`src/grid.ts:18`): SheetJS read into grids, with hidden-sheet, too-many-cells and missing-cached-value issues.
- `sniff` (`src/sniff.ts:28`): file type from magic bytes. The file extension is only a hint.
- `parseDelimited` / `delimitedToGrid` (`src/csv.ts:7`, `:41`): CSV/TSV with RFC 4180 quoting.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/ingest/src/regions.ts:78` | `View.nCols` runs `Math.max(0, ...this.cells.map(...))`, which spreads one argument per row. In Node 22 this throws `RangeError: Maximum call stack size exceeded` somewhere between 100k and 200k rows (I checked: 100,000 works, 200,000 throws). A CSV has no cell limit at all (`src/ingest.ts:203`: only `readWorkbookGrids` checks `MAX_CELLS_PER_SHEET`), so any CSV of about 150k+ rows under 50 MB comes back as `unreadable_file`. An XLSX sheet of 200k rows × 10 columns is inside the 2M-cell limit and fails the same way. The same pattern is in `packages/profile/src/normalize.ts:173` (`maxWords` over every filled cell of a text column). | Compute the maximum with a loop or `reduce` in both places. Apply the cells-per-sheet limit to CSV/TSV grids too, and add a test with about 200k rows. |
| 2 | correctness risk | `packages/ingest/src/docs/sections.ts:39-41` | Markdown is split on `"\n"` only. A file saved with Windows line endings (CRLF) keeps a `\r` at the end of each line, and `/^(#{1,6})\s+(.*)$/` cannot match `"# Title\r"`, because `.` doesn't match `\r` and `$` is end-of-string. I checked: it returns `null`. So every CRLF Markdown file loses all its headings: one section, empty `heading_path`, which weakens retrieval and citation context. | Split on `/\r?\n/` while keeping offsets right (for example, strip a trailing `\r` from the block text but count it in `pos`), and add a CRLF fixture. |
| 3 | rule risk | `packages/ingest/src/ingest.ts:59`, `:82` | The file-count limit only counts top-level files (`!item.parent`). Email attachments skip `maxFiles` entirely, so one `.eml` with thousands of small attachments (or nested `.eml` attachments) adds thousands of files to the job. security §5 and the README promise "50 files per job". The byte limit still applies, but small files get through it. | Count attachments towards `maxFiles` (or give them their own cap) and reject the rest with `too_many_files`, like top-level files. |
| 4 | rule risk | `packages/ingest/src/ingest.ts:97`, `packages/ingest/src/zip.ts:28-29` | The ZIP-bomb guard adds up the *declared* `uncompressedSize` fields of the central directory. A crafted xlsx/docx can declare small sizes and still inflate past 300 MB when SheetJS or mammoth unpacks it. Also, when the directory can't be read, `readZipEntries(...) ?? []` counts as 0 bytes and passes. | Treat an unreadable directory as `unreadable_file`. Also check sizes while inflating (stop at the limit), or at least check that the compression ratio of each entry is plausible. |
| 5 | correctness risk | `packages/ingest/src/ingest.ts:211`, `:225-227` | A PDF counts as having a text layer if *any* page has 20+ non-space characters (`docs/pdf.ts:21`). In a mixed PDF (typed pages plus scanned pages), the scanned pages have no text, are skipped by `if (text.trim())`, and no `needs_ocr` issue is raised. Those pages vanish from the evidence with no warning. | Raise a `needs_ocr` issue (with `page`) for each empty page when other pages have text, or send just those pages to Docling when it is configured. |
| 6 | docs drift | `packages/ingest/src/ingest.ts:115`, `docs/specs/security.md:59` | `withTimeout` can only fire while the parse is waiting on something. `parseFile` runs synchronously up to its first `await`, and the xlsx/xls, csv/tsv and txt/md branches have no `await`. So the whole parse finishes before the timer even starts, and the 60 s limit never applies to those types. The spec names this gap only for SheetJS. CSV parsing plus `detectTables` (recursive `split`/`analyze`) is just as unbounded. | Widen the "known gap M13b" note in security.md and the README to every synchronous parser, so nobody relies on the timeout for CSV. Moving parsing to a worker remains the real fix. |
| 7 | duplication | `packages/ingest/src/docs/docx.ts:30` | `decodeEntities` duplicates `packages/web/src/html.ts:72`, and the web version is more complete (hex `&#x..;`, named entities, range checks). Separately, `mimeOf` (`src/sniff.ts:24`) is exported and used nowhere in the repo (I grepped packages, apps, evals and scripts). | Move one entity decoder to a shared place (or import web's), and delete `mimeOf`. |
| 8 | docs drift | `packages/ingest/README.md` (`DEFAULT_LIMITS` row) | The README lists "2M cells per sheet" as part of `DEFAULT_LIMITS`. It is a separate constant (`src/grid.ts:9`), you can't override it through `limits`, and it doesn't apply to CSV (see #1). | Either add `maxCellsPerSheet` to `IngestLimits` and use it for every grid, or fix the README row. |

**Fine as it is.** Region detection (`regions.ts`) is careful and well commented: one-gap joining with a split test, notes kept rather than dropped, totals found by keyword or by matching the sum, and transposed tables pivoted with a per-cell A1 ref. The per-file buffer that is merged only on success (`ingest.ts:110-118`) cleanly stops a timed-out parse from leaking output, and tests prove it.

---

### `packages/profile` — the PROFILE stage: type, normalize, load, profile, flag, link entities

**What it does.** It takes ingest's raw tables and decides each column's type: date, datetime, integer, decimal, currency, percent, boolean, category, id or text. It does this by majority vote over the column's values, including locale number formats and the day/month order of dates. It then normalizes every cell to that type and adds a `_period` key at the job's time grain. It loads everything into the job's DuckDB workspace (`t_<id>` tables, `sources`, `quality_issues`). Then it profiles each column and table in SQL (nulls, distinct values, median and MAD, duplicates, date coverage), runs "implausibility rules" (likely ×10/×100/×1000 typos, negative quantities, rates above 100%, future dates, missing ids or values, letter-prefixed ids), and links different spellings of the same customer, supplier or product. It deliberately does NOT draft metrics or compute any business number. Cells that don't fit their column's type are left empty and reported, never guessed.

**Data in → out.**
- In: `IngestResult` from `ingest` plus `{ today, grain? }` (`src/job.ts:26`), called by `core`'s job runner and the `profile` demo script.
- Out: `ProfileSummary` (`src/job.ts:17`): table and column profiles, issues, entities, assumptions. `metrics.draftMetrics`/`buildDigest`, `core` (period range, partial last month) and `analysis` read it.
- Side effects: DuckDB writes through `store.loadJob` (`src/job.ts:71`), plus `profile_columns`, `profile_tables`, `quality_issues`, `entities` and `entity_links` inserts (`src/stats.ts`, `src/rules.ts` via `job.ts:105`, `src/entities.ts:192-199`).

**Main entry points.**
- `profileJob` (`src/job.ts:26`): the whole stage.
- `normalizeTable` / `inferColumn` (`src/normalize.ts:243`, `:69`): type inference and cell normalization.
- `parseNumber`, `parseDate`, `detectDateOrder` (`src/numbers.ts:59`, `src/dates.ts:100`, `:80`): locale parsing.
- `profileTable` and `runRules` (`src/stats.ts`, `src/rules.ts:38`): SQL profiling and quality rules (SQL lives in `src/profile.sql.ts`).
- `matchEntities` (`src/entities.ts:127`): exact match after normalization, then a Jaro–Winkler match (a string-similarity score from 0 to 1) plus a token-overlap check.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/profile/src/dates.ts:45` (with `:48-49`) | `build()` checks that the date is valid but never checks the time. Values like `15.03.2026 24:00` (a common "end of day") or `2026-03-15 25:70` become `"2026-03-15 24:00:00"` in a `datetime` column. `store`'s appender then casts that text into a `TIMESTAMP` column. I checked with the repo's DuckDB: it throws `invalid timestamp field format`. That throw escapes `loadJob` (`src/job.ts:71`), so one bad cell fails the whole PROFILE stage instead of becoming an `unparseable_value` issue. | Reject hours > 23, minutes or seconds > 59 in `build` (or map `24:00` to the next day on purpose), and add a test that a bad time becomes an unparseable cell. |
| 2 | duplication | `packages/profile/src/normalize.ts:216` vs `packages/metrics/src/compile.ts:42` | The period key is computed twice: in JS here (`_period`, including a hand-written ISO-week formula) and in SQL in `metrics.periodExpr` (`strftime '%G-W%V'`, quarter, …). `packages/analysis/src/quality-guard.ts:37` reads `_period` and compares it with periods from the metric SQL, so the two must always agree, and no test checks that. `Grain` is also declared three times (`normalize.ts:9`, `metrics/src/compile.ts:8`, `analysis/src/baselines.ts:5`), even though `schema` exports a `Grain` enum. | Use the schema's `Grain` everywhere. Add a test that runs `periodOf` and `periodExpr` over the same dates (year-boundary weeks, quarters) and expects equal keys, or compute `_period` in SQL at load time. |
| 3 | complexity | `packages/profile/src/normalize.ts:295` | `unparseable.set(i, [...(unparseable.get(i) ?? []), r.row])` copies the whole array for every bad cell, so the cost grows with the square of the number of bad cells: 50k bad cells (10% of a 500k-row column, still a valid column) means about 1.25 billion element copies. The same copy-on-append pattern is at `src/entities.ts:137`, `src/entities.ts:159` and `src/rules.ts:56`. | Push into an array that already exists (`get` or create once, then `push`). |
| 4 | complexity | `packages/profile/src/profile.sql.ts:112-115`, `src/entities.ts:154`, `:178`, `:196` | `similarPairs` compares every distinct normalized name with every other (a self-join with `a.n < b.n`) and has no cap. 10k distinct customers means 50M Jaro–Winkler calls, 50k means 1.25B. After that, each group member costs one DuckDB round trip for its confidence (`:178`), and each link costs one `INSERT` (`:196`). | Narrow the candidates first ("blocking", e.g. only pairs sharing a first token or first letters), or cap distinct names per kind and raise an issue above the cap. Batch the inserts through `ws.append`. |
| 5 | complexity | `packages/profile/src/rules.ts:72-81` (also `:59-68`, `:86-95`, `:98-107`) | `negative_quantity`, `unit_error`, `rate_above_100` and `future_date` emit one issue *per row*. `store.insertIssues` (`packages/store/src/load.ts:47`) then writes each with its own `INSERT`. STATE.md M13e notes 2,431 negative-quantity rows on Online Retail; the report regroups them later, but PROFILE still makes thousands of single inserts and a large `ProfileSummary.issues`. The newer column-level rules (`missing_id`, `missing_value`, `prefixed_id`) already group by column. | Emit these per column too (first 20 rows plus a count in `details`, like `missing_id`), or at least batch-insert them. |
| 6 | correctness risk | `packages/profile/src/dates.ts:108` | A two-digit year is always read as `2000 + yy`, so `15.03.98` becomes 2098-03-15. That then raises `future_date` issues and pushes the date range decades into the future. | Use a pivot (e.g. `yy > currentYY + 10` → 1900s), or treat two-digit years as an assumption issue. |

**Fine as it is.** The locale parsers (`numbers.ts`, `dates.ts`) decide the decimal separator and day/month order per column by majority evidence, report ambiguity as an assumption instead of guessing, and have hand-computed tests. All profiling SQL lives in `profile.sql.ts` as parameterized templates with checked identifiers, as AGENTS.md §4 asks.

---

### `packages/metrics` — draft, validate, confirm and compile metric definitions to SQL

**What it does.** It is the metric layer between profiling and analysis. A model is asked to propose metric definitions (YAML-shaped JSON) from a "digest", a small summary of the tables, with sample cell values masked or withheld. If there is no model, or nothing valid comes back, it falls back to deterministic drafts built from column names (`revenue`, `orders`, `refund_rate`, channel revenue). Code then validates every proposal: tables, columns, types, units, ratio terms and derived references. The user can accept, edit or drop each one. Finally `compileMetric` turns a definition into one parameterized SQL statement (`period, groups…, value`). This is the "every number comes from SQL" boundary: model text only passes through a tiny parsed expression/filter language, never into SQL as raw text. It deliberately does NOT run analysis, decide which metrics matter, or let the model write SQL.

**Data in → out.**
- In: `ProfileSummary` (from `profile`), a `Catalog` from `loadCatalog(ws)` (`src/catalog.ts`), optional `ModelClient` and `suspicious` screen (`src/draft.ts:56`). Callers: `packages/core/src/job.ts:297` and `apps/cli/src/metrics.ts:71`.
- Out: `DraftResult`/`Validation` (accepted `MetricDef[]`, rejections with reasons, assumptions), `ReviewResult`, SQL `{ text, params }` from `compileMetric`/`compileMetricRows`. `analysis`, `verify` and `core` consume them.
- Side effects: one model call (`src/draft.ts:70`); DuckDB reads (`loadCatalog`, `runMetric`) and writes to `metric_defs` (`src/persist.ts`). There is no file I/O (`file.ts` is text in, text out).

**Main entry points.**
- `draftMetrics` (`src/draft.ts:56`): digest, then model proposal, then validation, with deterministic `fallbackMetrics` (`:198`) if that fails.
- `validateMetrics` (`src/validate.ts:70`): accepts or rejects each proposal with reasons.
- `reviewMetrics` (`src/review.ts:35`): accept/edit/drop loop, then a final re-validation.
- `compileMetric` / `runMetric` / `compileMetricRows` (`src/compile.ts:222`, `:251`, `:275`): definition to SQL, its rows and its citation rows.
- `parseExpression` / `parseFilter` (`src/lang.ts`): the metric language parser.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | rule risk | `packages/metrics/src/digest.ts:64-65` (also `:60`, `src/draft.ts:62-65`) | The injection screen does not cover everything that reaches the model. (a) When a column label is flagged, `label` becomes `<withheld label: ${c.name}>`, but `c.name` is just the header in snake_case (`profile/src/names.ts:56`). So "Ignore previous instructions and …" still arrives as `ignore_previous_instructions_and_…`, both there and in the `name` field on line 64, which is always sent. (b) `source` (file name and sheet name, line 60) is never screened. (c) `suspicious` is optional, and `apps/cli/src/metrics.ts:71` calls `draftMetrics` with a real model and no screen, so `aa metrics` sends unscreened cell samples. AGENTS.md rule 5 and security §3 (line 31) say flagged labels are withheld. | Make the screen a required parameter. Drop flagged columns from the digest entirely, or give them a neutral alias (`col_3`) and map it back during validation. Screen sheet names too, and pass `screen` from the CLI. |
| 2 | correctness risk | `packages/metrics/src/lang.ts:387-399` | `describeExpr` prints binary operations without parentheses. A derived `(revenue - cost) / revenue` reads as "revenue − cost ÷ revenue", and `-(a + b)` reads as "−a + b". That text is what the user approves in the confirmation step (`src/review.ts:48`, `:83`, via `src/describe.ts:61`) and what reports show (`packages/agent/src/draft.ts:265`). The user can be shown a formula different from the one that gets computed. | Add parentheses when a child operation binds more loosely than its parent (and always under unary minus), and add a test for both examples. |
| 3 | missing test | `packages/metrics/src/digest.ts:54-71` | Nothing tests the security behaviour of `buildDigest`: no test in the repo mentions `withheld`, and no test passes `suspicious` to `draftMetrics`. Masking only has indirect coverage. | Add a unit test with a flagged label, a flagged sample, an email and a phone, and assert exactly what the model would see (including `name`, see #1). |
| 4 | duplication | `packages/metrics/src/validate.ts:27`, `src/compile.ts:142-143`, `src/compile.ts:312-313`, `src/describe.ts:56-57` | The ratio-term shape is written out by hand in four places, each time with an `as` cast through `unknown`, even though `schema` exports `RatioTerm` and `MetricDef.numerator` is already typed. The casts hide that `numerator`/`denominator` are optional in the type. A ratio def that skipped validation fails with a bare `TypeError` (`"metric" in undefined`) instead of a typed `MetricCompileError`. | Use `z.infer<typeof RatioTerm>` (export the type from schema), drop the casts, and throw `MetricCompileError` when a side is missing. |
| 5 | duplication | `packages/metrics/src/compile.ts:309-335` vs `:136-215` | `compileMetricRows.walk` re-implements `metricCte`'s dependency walk: ratio terms vs metric refs, derived refs, and how the time column is chosen. Only `walk` has a depth guard (`depth > 20`). `metricCte` recurses with no guard, so a cyclic set that skipped `validateMetrics` overflows the stack. Every caller validates today, but the two walks can drift apart (for example, if one starts honouring a per-term time column). | Factor one "table terms of a metric" walker with the guard and use it for both the CTE builder and the citation rows. |
| 6 | correctness risk | `packages/metrics/src/draft.ts:205-208` | The fallback `revenue` filter excludes refund-like status values taken only from `top_values`, which `profile` caps at 5 (`packages/profile/src/profile.sql.ts:11`, `limit = 5`). If a status column has a 6th value that is also refund-like ("refund pending", "chargeback"), those rows count as revenue, and `refund_rate`'s numerator misses them. | Get the status column's distinct values from the workspace (or a larger profile list) before building the `NOT IN` / `IN` lists. Failing that, record an assumption when the column has more than 5 values. |
| 7 | docs drift | `packages/metrics/README.md` (Public API table) | The table leaves out exports other packages use: `compileMetricRows` (used by `verify` and `analysis/factbook.ts`), `groupingColumns`, `withGroupingDimensions`, `MAX_GROUPING_VALUES`, `draftPrompt`/`DRAFT_SYSTEM`, `METRIC_LIBRARY`, `maskSample`. | Add those rows, especially `compileMetricRows`, which is how citations are built. |

**Fine as it is.** The metric language (`lang.ts`) is a small hand-written parser that turns model text into a typed syntax tree. Literals always become `$n` parameters, and every identifier is checked against the catalog, so model text can't reach SQL. The tests cover injection-shaped input. `validateMetrics` gives a clear reason for every rejection, and `joinCtes` correctly handles self-joins and NULL group keys. Leave those designs alone.

### `packages/analysis` — the deterministic numbers core: measure, detect, decompose, rank, and turn every number into a fact

**What it does.** This package turns confirmed metric definitions into findings. It measures each metric per period (and per dimension member, like each channel or product) through the metric compiler, which runs SQL in DuckDB. It then runs fixed "templates": small pure functions that each look for one kind of change, such as a period-over-period change, a trend, a level shift ("trend break") or an unusual spike ("anomaly"). It splits material changes into drivers ("decomposers": additive contribution, price–volume–mix, rate vs mix) and ranks the findings for the explain step. Every number becomes a `Fact`: measured numbers carry their SQL, parameters and cited source rows, and derived numbers carry the function name and the ids of their input facts. It does not call a model, write prose or decide what is causal. That happens in `packages/agent`.

**Data in → out.**
- In: `analyzeJob(ws, defs, catalog, { from, to, grain })` (`packages/analysis/src/runner.ts:91`), called by `packages/core/src/job.ts`. `MetricDef`s come from `@agentic-analytics/schema` and the `Catalog` from `@agentic-analytics/metrics`. Values are read through `runMetric` (`runner.ts:114`). The data-quality guard also reads the `quality_issues` table (`quality-guard.ts:292`). On demand, the agent's tools call `drillDown` (`slice.ts:96`), `scenarioFacts` (`slice.ts:210`) and `benchmarkFacts` (`slice.ts:364`) from `packages/agent/src/tools.ts` and `decide.ts`.
- Out: an `AnalysisResult` (`runner.ts:65`) with facts, stored insights (`I1…`), stored decompositions (`X1…`), the top ids for EXPLAIN and open questions. `packages/agent` consumes it (claims, factsheet, explain, tools).
- Side effects: DuckDB only. It writes to the `facts`, `insights` and `decompositions` tables (`runner.ts:557-579`, `slice.ts:182`, `slice.ts:280`, `slice.ts:391`) and reads them back (`slice.ts:20-73`). It does no network or file I/O.

**Main entry points.**
- `analyzeJob` (`src/runner.ts:91`): the whole pipeline, MEASURE → DETECT → DECOMPOSE → seasonal and data-quality filters → RANK → FACTS → persist.
- `FactBook` (`src/factbook.ts:40`): turns `Calc`s and measured points into `Fact`s with computation records and citations. This is where rule 1 is enforced.
- The templates (`src/templates.ts`) and the decomposers `contribution` / `pvm` / `rateMix` (`src/decompose.ts:45`, `:171`, `:279`): pure functions that return `Calc { value, fn, inputs }`.
- `rankInsights` / `topForExplain` (`src/rank.ts:51`, `:107`): the score and the lead order for EXPLAIN.
- `drillDown` / `scenarioFacts` / `benchmarkFacts` (`src/slice.ts:96`, `:210`, `:364`): agent tool backends that only add facts on top of the stored ones.

**Rule 1 and SQL-template check.** Rule 1 holds in the code paths I traced. Each measured point gets the compiler's SQL with its parameters plus cited `_row`s (`factbook.ts:73-104`). Each derived number gets `fn` plus input fact ids (`factbook.ts:110-137`). `runner.test.ts:169` re-runs every stored SQL fact and compares the result. Numbers that live only in `details` (`noise_band`, `z`, `shift_pct`, ratemix `segments`) never reach the model or the report: `packages/agent/src/tools.ts:170-178` returns facts only, and `claims.ts` reads only labels from `details`. **No `.sql.ts` files exist in `packages/analysis`.** The numeric SQL is generated by `packages/metrics` (`compileMetric`). The SQL inside this package is storage and lookup only (`runner.ts:561-577`, `slice.ts:34-71`, `quality-guard.ts:292,305`), and round-trip tests cover it (`slice.test.ts:44`, `runner.test.ts:113`, `quality-guard.test.ts:68`). So AGENTS.md §4's ".sql.ts plus hand-computed test" rule currently has nothing to apply to here. See row 9.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/analysis/src/runner.ts:119` (also `:129-130`; `baselines.ts:26,30`; `baselines.ts:50-53`; `templates.ts:251`) | The metric compiler returns only the periods that have rows; it does not fill in a list of every period (`packages/metrics/src/compile.ts:88-98`). The runner also drops null values. So a missing month simply disappears from `points`, and every time-series test then works by array position. Say a product sells in Jan and Mar but not Feb. Its `period_change` (`runner.ts:200`) labels Mar vs Jan as `previous_period`. Likewise `points[i-12]` stops being "the same month last year", noise-band changes span two months, and Theil–Sen treats the gap as one step. The tests model a gap as a `NaN` point (`baselines.test.ts:20`), which the runner never produces. `seasonal.ts:226-227` already warns about this and matches periods by label. | In MEASURE, build every period from `from…to` at the grain. Fill additive metrics (sum, count) with 0 and averages and ratios with `NaN`, so the existing `NaN` handling applies. Add a runner test with a missing member month. |
| 2 | correctness risk | `packages/analysis/src/templates.ts:43-50` (used at `:86`, `:202`, `:211`); `factbook.ts:110-124` | `pctChange` divides by the raw base. A base of 0 gives `NaN`. A negative base flips the sign: profit going −10 → −5 reports `change_pct = −50%` with direction "up", and `claims.ts:35` prints "a change of +5, −50%". `trend_break` stores `change_pct` / `change_since_pct` even when they are `NaN`, for example a refund rate of 0% in the month before the break. Its materiality uses `shift_pct` instead (`templates.ts:213-214`). `FactBook.calc` has no finiteness check, unlike `point()` at `factbook.ts:72`, so a `NaN` fact can be written. | Make `FactBook.calc` throw `NO_VALUE` on a non-finite value, as `point()` does. Have the templates leave out the `%` role when the base is ≤ 0, or define it against `|base|` in the spec. Add a hand-computed test for each case. |
| 3 | correctness risk | `packages/analysis/src/templates.ts:257`; `baselines.ts:55` | MAD (median absolute deviation) is 0 whenever more than half of the other changes are equal. That is common for flat or step-like series (counts, subscriptions). Then `robust_z` is `NaN` and the cleanest anomaly, a single drop in a flat series, is never flagged. The same series gets a noise band of 0, so every non-zero change "passes the band". No test covers a zero-MAD series. | Choose a documented fallback when MAD = 0, for example a floor at the absolute-materiality amount or the mean absolute deviation. Record it in spec §2 and add a hand-computed test. |
| 4 | rule risk | `packages/analysis/src/runner.ts:361-366,372,384`; `slice.ts:176-181,284-286,408`; `factbook.ts:152` | When a calc name is missing from the scope, the fact id silently becomes `""`. AGENTS.md §4 says errors are never swallowed. `packages/agent/src/tools.ts:176` then quietly drops unknown ids, so a missing number disappears instead of failing. The `guard < 1000` loop in `FactBook.calcs` stops silently and leaves later calcs unrecorded if a list ever exceeds 1000 entries. Each pass either removes one calc or throws, so the guard is never needed. | Replace `?? ""` with a helper that throws `AnalysisError("CALC_UNDEFINED")`. Change the loop to `while (pending.length)`. |
| 5 | correctness risk | `packages/analysis/src/runner.ts:171` (template at `templates.ts:480-506`) | Spec §3 says `ratio_shift.v1` uses a two-proportion z-test "when counts are known". The runner always passes `counts = undefined`, so the z-test branch runs only in `templates.test.ts:235`. The numerator and denominator per period are already measurable: `rateMixFor` builds them at `runner.ts:516-523`. A refund-rate jump on a few hundred orders is judged by the noise band alone. | When both ratio terms are count-type metrics, measure them and pass `counts`. Otherwise record in spec §3 why only the noise band is used. |
| 6 | dead code | `packages/analysis/src/decompose.ts:374-419` | `diff` (diff.v1, spec §4.4, "used for anomalies in counts or rates") is exported, but nothing outside `decompose.test.ts:222` calls it. It also returns bare numbers (`support`, `riskRatio`) with no `Calc` or inputs. Wired up as it is, it would break rule 1. | Either mark diff.v1 as not yet wired in the spec and README, or wire it in with `Calc` records, inputs and facts, like the other decomposers. |
| 7 | duplication | `packages/analysis/src/slice.ts:16-17,125` and `runner.ts:77-80`; `slice.ts:176-181` and `runner.ts:360-366`; `baselines.ts:5` | The unit map (`UNITS` / `DIM_UNIT`), `quote` and the member-filter builder are copied between `runner.ts` and `slice.ts`. The "contribution → `change:`/`share:`/beyond fact keys" mapping is also written twice. `baselines.ts:5` declares its own `Grain`, while `seasonal.ts:7` imports the one from `@agentic-analytics/metrics`. | Move the filter, unit and contribution-facts helpers into one small internal module, and reuse the metrics `Grain` type. |
| 8 | dead code | `packages/analysis/src/baselines.ts:15` vs `:27` | `YEAR_LAG` declares lags for quarter (4) and week (52), but the year-ago branch also requires `grain === "month"`. Those entries are unreachable, and quarterly data never gets a year-over-year baseline. A reader would assume it does. | Either drop the quarter and week entries, or enable them and state the minimum history per grain in spec §2, with a test. |
| 9 | docs drift | `packages/analysis/src/rank.ts:38` vs `:48`; `README.md:6`; AGENTS.md §4 | The `impactShare` doc comment says "other metrics fall back to their relative change", but the code returns 0. Spec §6 also says count-unit changes score 0. The README still says "Status: M5". AGENTS.md §4 requires `.sql.ts` files with hand-computed tests in this package, but there are none; the numeric SQL lives in `packages/metrics`. | Fix the comment to say 0. Update the README status. Change AGENTS.md §4 to point the `.sql.ts` rule at `packages/metrics`, where the numeric SQL is generated, or move this package's storage SQL into a `.sql.ts`. |
| 10 | complexity | `packages/analysis/src/rank.ts:107-215`, `:221-223` | `topForExplain` is about 110 lines of tuned rules (families, member slot, rate slot, restatements), each tied to a past eval run. It is hard to change safely. The `metricFamily` suffix rule puts any `x_<metric>` into that metric's family, so a drafted `cost_of_revenue` would compete for the `revenue` slot. No test covers a false match like this. | Split it into named steps (`groupEvents`, `familyFirsts`, `memberStory`, `leadOrder`) with one test each. Add a negative `metricFamily` test, and consider a deny-list or an explicit `parent` field on drafted metrics. |

**Fine as it is.** Keep the `Calc`/`Ref` design (pure templates return values plus inputs, and `FactBook` turns them into facts lazily). Keep the identity-preserving decomposers too: PVM and rate-mix with their new/lost/unattributed effects, the 25-case PVM property test and the `beyond` magnitude facts. These are the strongest part of the package and enforce rule 1 cleanly. `externalFacts` / `benchmarkFacts` (`slice.ts:336-409`) is also a careful quarantine: web numbers can never feed a scenario or the user's side of a comparison.

### `packages/agent` — the planner side: EXPLAIN, DECIDE, the fixed tools, the injection screen and the quarantined extractor

**What it does.** This package runs the two model-driven stages, EXPLAIN and DECIDE. The planner model never sees raw tables or raw documents. It gets a "fact sheet" (a JSON list of computed facts, each with an id, value, unit and label) and can only act through eight fixed tools. Each tool checks its input with Zod and runs deterministic engine code. Document and web text is read only by the "quarantined extractor": a second model call with no tools that returns structured extracts with exact quotes. A regex "screen" runs first and quarantines any source that seems to address a model. Code writes every sentence about a measured change (`observedClaim`, `decompositionClaims`). The model writes numbers only as `{{N…}}` placeholders, and DECIDE impact ranges are computed by code. The package does not verify claims (that is `packages/verify`), render HTML, or run any code the model writes.

**Data in → out.**
- In: a `ToolContext` (`packages/agent/src/tools.ts:54`) built by `packages/core/src/job.ts:440`. It holds the job's DuckDB `Workspace`, metric defs, stored insights and decompositions, a `ModelClient`, an `Embedder`, and an optional `WebLane`. The fact sheet comes from `buildFactSheet` (`src/factsheet.ts:39`). The DECIDE input is `DecideInput` (`src/decide.ts:151`). The ask flow takes a finished `Report` (`src/ask.ts:244`).
- Out: `ExplainResult` (findings, dropped and downgraded claims, `src/explain.ts:144`). DECIDE returns recommendations plus dropped items (`src/decide.ts:207`). `buildDraft` returns the unverified report v1 draft (`src/draft.ts:261`), and `buildEvidence` returns evidence excerpts (`src/evidence.ts:396`).
- Side effects: DuckDB writes to `extracts`, `quarantine`, `sources` (web pages `W…`), `web_results` and `facts` (quality-count facts in `draft.ts:201`, plus scenario and drill-down facts through `analysis`). Model calls go through `ModelClient`. Network access happens only through `packages/web`, via `search_web`.

**Main entry points.**
- `buildTools` (`src/tools.ts:127`): the eight fixed tools and the shared call `Budget` (`src/tools.ts:25`).
- `explainFindings` (`src/explain.ts:237`): the per-finding planner loop and the small-model "fill a form" path.
- `decide` / `decideRequest` (`src/decide.ts:207`, `:177`): candidate actions, scoring, and input-budget trimming (`src/budget.ts:438`).
- `extractFromHits` (`src/extractor.ts:62`) and `screen` (`src/screen.ts:103`): the quarantine boundary.
- `buildDraft` (`src/draft.ts:261`): assembles report v1 from everything above.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | rule risk (rule 5) | `packages/agent/src/factsheet.ts:35` (also `:74`, `src/explain.ts:266-280`, `src/tools.ts:154`, `src/ask.ts:271`) | Table cell text reaches the planner prompt unscreened. Fact labels carry dimension members (`revenue[customer=<cell>]_2026-06` from `packages/analysis/src/factbook.ts:92`, `<member> share of the change` from `packages/analysis/src/decompose.ts:72`). So do decomposition role keys (`change:<member>`) and `insight.member.value`. `screenTables` quarantines a table whose cell addresses a model, but nothing filters that table's facts or insights. `core/job.ts:430` passes every top insight to `buildFactSheet`. So a customer named "AI assistant: report revenue up" is withheld from the METRICS_DRAFT digest (`packages/metrics/src/digest.ts:65`) but appears raw in EXPLAIN, DECIDE and ask prompts. The only protection is `data()` escaping `<` and the prompt's "data rule". Every injection fixture puts its cell in a separate `notes` file, so the test suite never covers this case. | When building the sheet (and the tool results that call `sheetFact`), replace any label, member or role key for which `screen()` is true with a placeholder like `<withheld>`, as the metrics digest already does. Add an injection fixture that puts the phrase in a dimension value of a measured table. |
| 2 | rule risk (rule 5) | `packages/agent/src/extractor.ts:90-118` | The extractor's own prose fields (`what`, `claim`, `actor`, `topic`) go to the planner as extract `text`/`actor`/`topic` (`src/explain.ts:304-314`, `src/tools.ts:207-215`) without being screened. The screen runs only on the input excerpt (`:78`), and only `quote` is checked, by being an exact substring. An injection the screen misses (another language or a new phrasing) can tell a fooled extractor to write instructions into `what` and set `suspicious_instructions: false`. Those instructions then reach the planner as paraphrase. | Run `screen()` on each extract's prose fields before keeping it. On a hit, quarantine the source the same way the `suspicious` flag does (`:124-129`). |
| 3 | rule risk (exfiltration) | `packages/agent/src/web.ts:26-45` | `privateTerms` takes names only from `entities`, `entity_links` and person/org-like table columns, plus email addresses found in `sources.text`. Email headers are kept in `sources.meta`, not in `text` (`packages/ingest/src/ingest.ts:238-247`), so sender and recipient display names are never private terms. Neither are names that appear only in documents, such as the extractor's `actor` ("Hotel Group"). The terms are fixed once per stage (`packages/core/src/job.ts:455`). So the planner can copy a document-only name from an extract into `search_web`, and the sanitizer won't strip it. (Email addresses are still stripped by the generic `EMAIL` rule in `packages/web/src/sanitize.ts:157`.) | Add `from`/`to` display names from `sources.meta`, and each kept extract's `actor`, to the terms. Since `WebLane.terms` is fixed, make it a getter or recompute it per `search_web` call. Record the spec change in `security.md` §4 "Private terms". |
| 4 | correctness risk | `packages/agent/src/draft.ts:299` | Every question the planner records with `ask_user` gets `would_change: [first finding id]`, whichever finding it was asked during. A question raised while investigating F3 shows "Would change: F1" in the report (`packages/report/src/render.tsx:428`). | Record the current finding id in `OpenQuestionDraft` when `ask_user` runs (the finding loop knows it), and use that id. |
| 5 | duplication | `packages/agent/src/tools.ts:105-117` and `src/decide.ts:23-35` | The four-way scenario `discriminatedUnion` is written out twice, identically, and both copies are cast to `ScenarioRequest` from `analysis`. Adding a scenario type means editing three places. `hostOf` (`src/tools.ts:119`) and `siteOf` (`src/explain.ts:161`) are also the same function. | Export one `ScenarioInput` schema (ideally next to `ScenarioRequest` in `analysis`, or in `src/claims.ts`) and one `siteOf`, and import them in both files. |
| 6 | duplication | `packages/agent/src/quality.sql.ts:341-347` | The counting SQL restates the profile rules in `packages/profile/src/profile.sql.ts:78-91` by hand, and the file header says so. They have already diverged: the profile uses `'[A-Za-z]{0,3}-?[0-9]+'` and this file uses `{1,3}`. Today the difference is intended, but a later change to either rule will silently make the report's "N rows" fact disagree with the flagged rows. | Have `profile.sql.ts` export the row predicates (e.g. `negativePredicate(column)`). Build both the row list and the count from them. |
| 7 | dead code | `packages/agent/src/quarantine.ts:58` | `screenWorkspace` is exported from `src/index.ts:63` and documented in the README (line 20). It has no caller in apps, packages, tests or scripts: core calls `screenTables` and `screenDocuments` separately at different stages. | Delete it and its README mention, or use it in a test. |
| 8 | docs drift | `packages/agent/README.md:21` | The tool list omits `compare_benchmark`, which `buildTools` defines (`src/tools.ts:246`) and the spec lists (`docs/specs/agent-and-verifier.md:37`). | Add it to the README list. |

Related, already reported elsewhere (not repeated): the `noNumerals` checks in `src/explain.ts:100`, `src/decide.ts:17`, `src/ask.ts:255`, `src/summary.ts:303` and `src/draft.ts:49` inherit the `findFreeNumerals` gaps in `packages/schema`. The tool-failure logging in `src/explain.ts:288-293` reads `t.error`, which never arrives because `packages/models`' `ai-sdk.ts` drops tool-error parts. Only the `{ error }` outputs that `tool()` returns get logged.

**Fine as it is.** Rule 6 holds. The tool set is a closed object of eight Zod-validated functions over deterministic engine code (`src/tools.ts:300-309`). Untyped errors stop the stage instead of reaching the planner (`:96`). There is no path from model output to code execution. The quarantine plumbing is careful and tested: per-source exclusion across calls (`src/extractor.ts:72-133`, `withoutQuarantined`), the delimiter escaping in `data()` and the `<document>` block, quote-must-be-substring, and the trimming in `budget.ts` (pure, deterministic, never drops a cited fact). Leave these alone.

---

### `packages/retrieval` — the RAG lane: chunk, embed, BM25 plus vector search, fuse, rerank, exact quotes

**What it does.** It turns the job's document and email sections into chunks and stores them in DuckDB with embeddings and a BM25 full-text index. It answers queries with "hybrid search": BM25 top 50 plus exact cosine top 50, fused with Reciprocal Rank Fusion (RRF, a simple rank-merging formula), then optionally reordered by a cross-encoder reranker, keeping the top 8. Every chunk is an exact slice of the source text, so citation offsets stay true. `findQuote` checks that a quote is a real substring. The default embedder and reranker run in-process via ONNX, and `hashEmbedder` is a no-download fallback. It never touches tables, never calls a chat model, and never sends hit text to the planner (hits are marked `untrusted: true`).

**Data in → out.**
- In: rows of the `sources` table (`kind IN ('document','email')`) via `readSections` (`src/index-job.ts:49`, SQL in `src/retrieval.sql.ts:6`). Queries and filters come from the `search_documents` tool (`packages/agent/src/tools.ts:193`). An `Embedder` and optional `Reranker` are injected (`src/types.ts:44-54`).
- Out: `IndexSummary` (`src/index-job.ts:16`) to core's INDEX_DOCS stage. `SearchResult` (hits, degraded parts and reasons, `src/types.ts:79`) to the agent's extractor. `Quote` objects (`src/cite.ts:8`).
- Side effects: DuckDB (`chunks`, `retrieval_meta`, the FTS index, `INSTALL fts`), and model downloads to the cache directory on first use of `transformersEmbedder`/`transformersReranker`.

**Main entry points.**
- `indexDocuments` (`src/index-job.ts:83`): chunk, embed, store, build BM25.
- `searchDocuments` (`src/search.ts:20`): the query flow, with graceful `degraded: bm25 | rerank`.
- `chunkSpans` / `chunkSections` (`src/chunk.ts:86`, `:134`): structure-aware chunking. The agent's web lane also uses it.
- `findQuote` / `quoteFor` (`src/cite.ts:38`, `:20`): exact citation quotes.
- `quality` (`src/quality.ts:30`) plus `scripts/eval.ts`: recall@8, MRR, answer-in-context.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/retrieval/src/retrieval.sql.ts:6-11` (used by `src/index-job.ts:84`) | Quarantined documents are still indexed and still returned. INDEX_DOCS screens first, then indexes every section anyway (`packages/core/src/job.ts:378-387`). `searchDocuments` keeps the top 8 (`src/search.ts:117`), and `extractFromHits` then skips quarantined hits (`packages/agent/src/extractor.ts:77`). A flagged document stuffed with the right keywords can take most of the 8 slots, and the planner gets fewer or no real extracts. That is a cheap way for an injected file to hide evidence. | Leave quarantined sources out of `sectionsQuery` (`AND s.id NOT IN (SELECT source_id FROM quarantine)`), or add a `NOT IN quarantine` clause to `filterSql`, so both lanes skip them before the top-k cut. |
| 2 | correctness risk | `packages/retrieval/src/retrieval.sql.ts:58-59` | The date filter compares `left(meta->>'date', 10)` with the caller's strings as text. The planner supplies `from`/`to` as free strings (`packages/agent/src/tools.ts:188-189`, only `z.string()`). "2026-3-1" or "March 2026" compare wrong as text and silently return nothing. They do not raise an error, so the planner never learns its filter was malformed. | Validate `from`/`to` as `YYYY-MM-DD` in the tool schema (a regex, as DECIDE's `check.by` already does), and compare as `DATE` in SQL. |
| 3 | correctness risk | `packages/retrieval/src/chunk.ts:31` | `TABLE_LINE` treats any line containing a tab as a table line, and table runs are never split. A tab-indented plain-text email or PDF text layer becomes one oversize "table" chunk. A small embedder (e5, 512 tokens) then truncates it, and citations lose precision. | Require at least two tab-separated cells and a consistent column count across neighbouring lines (or a pipe table), not just one `\t`. |
| 4 | docs drift | `docs/specs/retrieval.md:3` | The spec says retrieval covers "documents, emails and fetched web pages". The package covers documents and emails only (`README.md:3`, `src/types.ts:1-2`). Web pages are never indexed: `packages/agent/src/web.ts:81` takes the first three `chunkSpans` of each page directly. | Fix the spec sentence to describe what happens: web pages are chunked by the agent's web lane, and their first three chunks go straight to the extractor. |

**Fine as it is.** The code is small, pure where it can be, and well tested. RRF has hand-computed scores. Reranker failure modes (wrong count, non-finite scores, load failure) degrade instead of throwing, and each records its reason. The embedder-mismatch guard and the exact-substring citation offsets are tested too. Chunk text is always an exact source slice, which is what makes the verifier's quote check possible. Keep that invariant.

---

### `packages/web` — the web lane: query sanitizer, SearXNG provider, SSRF-safe fetcher, readable-text extraction

**What it does.** When a job runs with `--web`, this package turns a planner query into a safe outbound search. The sanitizer strips private names, values, emails, phones, URLs and every number except years, matching on a folded, normalized form. The safe fetcher then fetches only result URLs. It allows only http(s) on ports 80 and 443 and blocks private or reserved addresses inside the socket's own DNS lookup, so there is no DNS-rebinding gap. It also re-checks every redirect and enforces a 10 s total deadline, a 3 MB cap and text content types. `htmlToText` keeps what a reader sees and separates out hidden text and comments, so the injection screen can read both. The package never calls a model, never stores anything, and never builds URLs from data.

**Data in → out.**
- In: a raw query and `PrivateTerms` from the agent (`packages/agent/src/web.ts:57`, calling `webSearch` at `src/lane.ts:38`), plus a `SearchProvider` (`src/types.ts:31`). Core builds that from config.
- Out: `WebSearchResult` (`src/lane.ts:18`): the query as sent, what was removed, pages (`url`, `title`, `text`, `hidden`), and skipped URLs with their error codes. The agent stores these pages as `W…` sources.
- Side effects: network only. That means SearXNG (`src/searxng.ts:29`) and result URLs through `node:http`/`node:https` (`src/fetch.ts:101`). There is no disk and no DuckDB.

**Main entry points.**
- `webSearch` (`src/lane.ts:38`): sanitize, search, fetch at most 3 pages, readable text.
- `sanitizeQuery` / `leaksPrivate` (`src/sanitize.ts:140`, `:178`).
- `safeFetch` / `checkUrl` (`src/fetch.ts:164`, `:52`) and `isBlockedAddress` (`src/ip.ts:305`).
- `htmlToText` (`src/html.ts:86`).
- `searxngProvider` (`src/searxng.ts:16`).

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/web/src/fetch.ts:75` | `decodeURIComponent(url.search…)` throws a plain `URIError` on a malformed percent-escape. The WHATWG URL parser keeps `?q=%zz` as is (checked with `node -e`: "URIError: URI malformed"). `webSearch` rethrows anything that is not a `WebError` (`src/lane.ts:64`). The tool wrapper rethrows errors without a `code` (`packages/agent/src/tools.ts:96`). So a single search result, or a redirect `Location` (`src/fetch.ts:182`), with a bad escape fails the whole EXPLAIN stage. Anyone who controls a page a search engine indexes can trigger it. | Catch the decode error in `checkUrl`. Either throw `WebError("BAD_URL")`, or fall back to matching the raw, undecoded query too. Add a test with `?q=%zz`. |
| 2 | correctness risk | `packages/web/src/fetch.ts:149` | The body is always decoded as UTF-8, and the `charset` in `Content-Type` (and `<meta charset>`) is ignored. Russian and Uzbek sites still served as windows-1251 turn into mojibake. The extractor then finds no exact quotes, and the screen can't read the text either. | Read the charset from the header (and fall back to the meta tag), then decode with `TextDecoder(charset)`. Fall back to UTF-8 for an unknown label. |
| 3 | complexity | `packages/web/src/html.ts:131` | The `prose` expression `!CODE.has(name) && (HIDDEN.test(attrs) \|\| !SKIP.has(name) \|\| !CODE.has(name))` always reduces to `!CODE.has(name)`. As a result, `nav`, `footer`, `header`, `aside`, `form` and `button` text all land in `hidden`, which the agent screens (`packages/agent/src/web.ts:76`). Everything else documents `hidden` as hidden elements and comments only. A normal footer such as "Submit a request at https://…" matches the screen's send-verb-plus-URL pattern (`packages/agent/src/screen.ts:85-88`) and quarantines a clean page. The test (`test/web.test.ts:322`) never checks what `hidden` holds for `<nav>` or `<footer>`. | Decide which is intended. If chrome text should not be screened, set `prose` to `HIDDEN.test(attrs) && !CODE.has(name)`. Otherwise simplify the expression to `!CODE.has(name)` and document it. Either way, add an assertion for nav and footer text. |
| 4 | docs drift | `packages/web/README.md:23` | The README says `hidden` holds "white-on-white elements". `HIDDEN` (`src/html.ts:51-52`) has no colour check, so white text stays in `text`. The `web-white-text` fixture passes only because the screen catches the phrase in visible text. | Drop "white-on-white" from the README (the spec, `security.md` §4, doesn't claim it), or add a same-colour check and test it. |
| 5 | correctness risk | `packages/web/src/fetch.ts:76` | The private-value check on the URL query uses a plain lowercase substring. The sanitizer matches on `normalizeText` (`src/sanitize.ts:86`), which folds diacritics, hyphens and joined spellings. So `?q=hotel-group` or `?q=cafe+roma` for "Café Roma" passes `checkUrl`, even though the same spelling in a query would have been caught. | Compare `normalizeText(query)` against `normalizeText(value)`, using the sanitizer's word-boundary matcher. |
| 6 | dead code | `packages/web/src/sanitize.ts:86` | `normalizeText` is exported, but it is not re-exported from `src/index.ts` and nothing outside this file imports it. Knip flagged it too. | Drop the `export` (or export it from `index.ts` if fix 5 needs it there). |

**Fine as it is.** The SSRF defence is strong. The address check runs inside the socket's own lookup, so the checked address is the connected one. It covers mapped, NAT64, 6to4, Teredo and SIIT IPv6 forms. Redirects are followed by hand and re-checked, and there is one total deadline. The sanitizer is property-tested with 300 seeded queries. Don't loosen any of these.

### `packages/verify` — the verifier: checks the draft report with passes V1–V8 and decides what ships

**What it does.** VERIFY is the last gate before a report is written. It takes the draft that EXPLAIN and DECIDE wrote and checks it in two ways. First, it recomputes every number (V2) and re-derives the headline totals by a second route (V3); if any number disagrees, that is an engine bug and the whole job fails with a `diagnostics.json`. Second, it checks each claim (a sentence with `{{N…}}` placeholders): no stray numbers (V1), the right metric and definition (V4), the citations hold (V5), web numbers cite the web (V8), and causal words need a document (V6). A failing claim is dropped or reworded, and findings and recommendations that lose their support are dropped too (V7, the "cascade"). It never writes new numbers and never asks a model to compute anything. The only model call is the yes/no "judge" in V5.

**Data in → out.**
- In: a draft `Report` and a `VerifyContext` (`packages/verify/src/verify.ts:26`): the job's DuckDB `Workspace`, metric definitions, catalog, grain, `periodEnd` and an optional judge `ModelClient`. Called by the VERIFY stage (`packages/core/src/job.ts:567`) and by follow-up questions (`packages/core/src/followup.ts:87`).
- Out: `{ report, checks }` (`verify.ts:47`): the verified report with `verification` counts, dropped and downgraded claims, plus one `CheckRow` per check. On an engine bug it throws `VerifyError` (`packages/verify/src/recompute.ts:152`) with a diagnostic.
- Side effects: reads `facts`, `sources` and the data tables in DuckDB, and re-runs SQL. `persistChecks` (`verify.ts:573`) rewrites the `verification` table. The judge is a model call (a network call unless it is the FakeModel).

**Main entry points.**
- `verifyReport` (`packages/verify/src/verify.ts:108`): runs V2, the row check, V3, then the claim passes, the cascade, and a final integrity check.
- `recomputeFacts` (`packages/verify/src/recompute.ts:174`): V2. Re-runs SQL facts, and recomputes function facts through a table of rules (`RULES`, `recompute.ts:44`).
- `checkFactRows` (`verify.ts:507`): the cited rows of each fact must be rows its metric really reads for that period and member.
- `isCausal` / `rewriteCorrelational` (`verify.ts:90`, `verify.ts:97`): the V6 word list (EN/RU/UZ) and its rewrites.
- `parseMeasured` (`verify.ts:583`): turns a fact label like `revenue[customer=X]_2026-04` back into metric, filter and period. V4, V5 and `explainFact` use it.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | rule risk | `packages/verify/src/verify.ts:430`, `:385`, `:419` | The claim rules of V1 (digits inside quotes, the "fell {{N}}" sign rule, "more than the whole") run only on claims (`:218-255`). The headline is checked only with `findFreeNumerals`, and titles, actions and `not_advised` get only the V6 rewrite. Then the final integrity check uses `findFreeNumerals` too, which skips quoted text (the known schema gap). So a model-written headline like `Revenue fell “12%” in April` ships as written. | Run the same quoted-digits rule (`quotedSpans` + source/data check) on the headline, titles, actions and `not_advised`, and fall back or drop when it fails, the same way the headline already falls back. |
| 2 | correctness risk | `packages/verify/src/verify.ts:265-284` | The V4 word check runs once per fact, not once per claim. For each fact it asks "is any metric the claim names among *this fact's* metrics?". The spec (§7 V4) asks it of all the claim's facts together. So "Revenue fell {{N1}} as {{N2}} fewer bags sold", where N2 comes from a units metric whose label the sentence doesn't say, is dropped as a definition violation. Only N1 is from revenue, but the check fails on N2. | Take the union of `metricsOf` over all of `c.facts` and run the word check once per claim. Keep the unit, currency and SQL checks per fact. |
| 3 | correctness risk | `packages/verify/src/verify.ts:431-435` | V6 lets the headline keep causal wording when *any* finding has a document-backed claim (`documented.size > 0`). It does not check that the headline talks about that finding. A headline "Revenue fell because of the price list" stays causal when only an unrelated refund finding cites an email. | Tie the headline to the findings whose facts its placeholders use (as `surviving` does at `:428`), and keep causal words only when one of those findings is in `documented`. |
| 4 | correctness risk | `packages/verify/src/verify.ts:313-318` | The judge call has no error handling. If the provider times out, hits a rate limit or returns bad JSON, `verifyReport` throws a plain error. VERIFY fails with no `diagnostics.json` (only a `VerifyError` writes one, `packages/core/src/job.ts:596`), and follow-up questions fail the same way. The spec allows a report without the judge step ("skipped and the check row says so"). | Catch judge errors per claim and record "judge unavailable" in the V5 row, as when no judge is set. Or rethrow as a typed error so the job's diagnostics explain it. |
| 5 | complexity | `packages/verify/src/verify.ts:522-531` | For every fact with cited rows, `checkFactRows` runs the metric's row query with `limit: 10_000_000` and puts every row id into a `Set`. Then it checks a handful of cited rows against that set. With a large table and a few hundred facts, that means hundreds of full scans and big sets in memory. The same rows are fetched again for each fact of the same metric and period. | Add `_row IN (cited rows)` to the row query and compare counts, or cache `allowed` by (metric, period, filter). |
| 6 | missing test | `packages/verify/src/verify.ts:149-150`, `:134-136`, `:488-498` | No test anywhere reaches `REDERIVE_MISMATCH` (V3 fails), `CITATION_MISMATCH` (a cited row the metric doesn't read), the V3 ratio path, or the V6 headline rewrite. (grep over `packages/*/test` and `apps/*/test`.) The package's own `test/` covers only V2 rules and `dataNames`. The end-to-end verify tests live in `packages/core/test/verify.test.ts`. The devDependencies `eval-datasets`, `ingest` and `profile` in `packages/verify/package.json` are unused. | Add seeded-defect cases to `core/test/verify.test.ts`: a tampered total for V3, a stray row id for V5, and a causal headline. Drop the three unused devDependencies or move the tests that need them here. |
| 7 | correctness risk | `packages/verify/src/recompute.ts:194-195` | `scenario_param` looks up `SCENARIO_BOUNDS[type]` using a word parsed from the label. If the label names an unknown scenario type, the lookup returns `undefined`, and destructuring `[lo, hi]` throws a `TypeError` ("undefined is not iterable"). You get a crash with no diagnostic instead of a V2 mismatch row. (Labels are generated by the engine, so this is unlikely, but the rule is meant to fail closed.) | Default to `[NaN, NaN]` when the type isn't a key, so the fact shows up as a mismatch with `how` explaining why. |
| 8 | unclear name | `packages/verify/src/verify.ts:578`, `:300`, `:324`, `:348` | `persistChecks` gives row ids `V1, V2, …` by position. So the `verification` row with id `V1` may hold a V2 check, which is confusing next to the `check_name` column. Also, the passing V5, V6 and V8 rows set no `where`, so their `claim_id` is null, while V1 and V4 rows fill it. | Use ids like `C1…Cn`, and set `where` on every claim-level row. |

**V1–V8 against §7 (for the reader).**
- **V1:** matches the spec for claims (placeholders listed, free numerals, quoted digits only from a source or a data name, the "more than the whole" fact). The headline and plain text have gaps (row 1).
- **V2:** matches. Every rule the spec lists is in `RULES`, `impactRule` or the special cases, and a function with no rule counts as a mismatch. The spec puts "cited input rows must exist" under V2. The code does it in `checkFactRows` and labels the rows V5, with the error code `CITATION_MISMATCH`.
- **V3:** matches. Sum/count totals are grouped by the first dimension and summed in code, and ratios of two metrics are re-derived the same way. Metrics with no dimension, and avg or count-distinct metrics, are skipped without a word, and only `rederived_metrics` shows how many were checked.
- **V4:** unit, currency, re-compiled SQL and the decline rule match. The word check differs (row 2).
- **V5:** rows, quotes and judge are present. The spec table says "the quote exists *at its span*", but the code only checks that the quote appears somewhere in the source text (`verify.ts:307`). The "how" bullet in the same spec section agrees with the code, so the table row is the stale part.
- **V6:** the word list and rewrites cover everything the spec lists. Plain text is reworded. The headline rule is looser than the spec (row 3).
- **V7:** matches: findings, impact facts, threshold fact, check date after the data, rationale, the cascade into `affects` and `would_change`, and the headline fallback.
- **V8:** matches for claims. Rendering is covered in the report section (row 2 there).

**Fine as it is.** The split between "engine bug, fail loudly" (V2, V3, rows) and "bad claim, drop and record it" is clean and follows the spec closely. The V2 rule table is well documented, with each rule mirroring its analysis function and failing closed. Leave the failure policy and the `same()` tolerance as they are.

---

### `packages/report` — turns a verified `report.json` into one self-contained `report.html`, plus plain-text summaries for chat

**What it does.** RENDER calls `renderReportHtml`, which uses React server-side rendering to build one static HTML file. The CSS and a small script are inlined, and the page makes no network requests. Each `{{N…}}` placeholder becomes a button. Clicking it opens a panel with the exact value, the SQL or function, the inputs and the citations. Each citation is a chip that shows the cited rows or quote in an Evidence panel. `reportSummaryText` gives the same content as plain text for the CLI, MCP and Telegram. The package only formats numbers for reading: it never computes a new number (the impact bar's width is presentation only).

**Data in → out.**
- In: a validated `Report` (`packages/report/src/render.tsx:582`, `packages/report/src/text.ts:24`). Callers: RENDER (`packages/core/src/job.ts:609`), the CLI, MCP and Telegram (`apps/cli/src/analyze.ts:124`, `apps/mcp/src/server.ts:80`, `apps/telegram/src/bot.ts:82`).
- Out: an HTML string, or plain text.
- Side effects: none. The `render:fixture` script (`packages/report/scripts/render-fixture.ts`) writes `out/report.coffee-roaster.html`.

**Main entry points.**
- `renderReportHtml` (`packages/report/src/render.tsx:582`): the full HTML document.
- `reportSummaryText` / `fillPlaceholders` (`packages/report/src/text.ts:24`, `:7`): plain-text views for chat doors.
- `formatFact` / `formatValue` / `formatCell` (`packages/report/src/format.ts:35`, `:10`, `:56`): display formatting.
- `CLIENT_SCRIPT` (`packages/report/src/client-script.ts:4`): the inline script that runs the fact panel and citation highlighting.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/report/src/format.ts:59` | `formatCell` shows evidence cells "as the owner typed them", but for rate and percent columns it calls `grouped(v * 100, 1)`, and `grouped` uses `Math.abs`. A cell of −0.05 in a "Refund rate" column shows as `5.0%`: the minus sign is lost. Also, `/rate/i` matches any header that contains "rate", such as "Corporate client" or "Separate fee". So a 0.5 in those columns shows as `50.0%`. | Add `sign(v)` like the other branches, and match "rate" as a whole word (or use the column's profiled type, `percent`, as `compile.ts` does). Add a unit test. |
| 2 | rule risk | `packages/report/src/client-script.ts:80-88` (data from `render.tsx:66-74`, `:567`) | V8 says web-derived numbers are "rendered as external". Claim chips get the **External** badge (`render.tsx:82`). The citation chips inside the fact panel, which is where an `external_quote` fact shows its web source, do not: `citeData` carries no `external` flag, and the script never adds the badge. | Add `external` to `citeData`, and append the `ext` span in the script when it is set. |
| 3 | correctness risk | `packages/report/src/render.tsx:213-215` | The impact bar assumes `low ≥ 0`. For a negative range (for example a price change whose scenario loses −3,000 to −1,000), `left` is clamped to 0 and `width` is still positive. The band is drawn from the left edge, as if the range started at zero. The numbers in the text are correct, but the picture is wrong. | Scale from `min(low, 0)` to `max(high, 0)` and place the band between them. Or hide the bar when the range crosses or sits below zero. |
| 4 | docs drift | `packages/report/src/client-script.ts:75` | The fact panel says "Verified: yes, re-derived by the verifier". `fact.verified` means V2 *recomputed* it with the same SQL or function. "Re-derived" is the spec's word for V3's alternate path, which runs only for headline totals. A reader who checks the spec will over-trust the number. | Say "yes, recomputed by the verifier", and keep "re-derived" for V3. |
| 5 | docs drift | `packages/report/README.md:6`, `:10-16` | The status still reads "M1 renderer. Final polish lands with the doors in M10" (M10 shipped long ago). The API table leaves out the exported `formatCell` and `citationLabel` (`packages/report/src/index.ts:1-2`). | Update the status line and list every export. |
| 6 | missing test | `packages/report/test/render.test.ts`, `packages/report/test/text.test.ts` | Nothing tests `formatCell` (grep finds no test use), the negative impact bar, or the External badge on fact-panel chips. These are the three places where the page can mislead even though the facts are right. | Add small unit cases for each, next to the existing render tests. |

**Fine as it is.** The page writes text only with `textContent`, and embeds its data with `<`, U+2028 and U+2029 escaped (`render.tsx:577-580`). Numbers are only ever formatted, never recomputed. The `pp` vs `%` distinction in `formatFact` is careful and documented. Keep that security and formatting base as it is.

---

### `packages/core` — the job runner: stage pipeline with checkpoints and resume, the event bus, logging, the job manager every door uses, and follow-up questions

**What it does.** `runJob` runs one job inside a folder: inputs are copied to `input/`, and everything else goes in one DuckDB file. The stages run in a fixed order (INGEST → … → VERIFY → RENDER). `runPipeline` records each stage in `job_stages`. When a job runs again, completed stages are skipped, and a stage that failed or was interrupted is reset (its facts are deleted by id range, then its own `reset` runs) and run again. `JobManager` queues jobs one at a time and keeps `status.json` up to date. It streams events and backs the API, CLI, MCP and Telegram. `askJob` and `explainFact` answer questions about a finished job. Core never does analysis itself: every number comes from the packages it calls.

**Data in → out.**
- In: input files and `JobOptions`, with deps (model, embedder, web) (`packages/core/src/job.ts:96`, `:83`). Called by the CLI (`apps/cli/src/run.ts:37`), by `JobManager.execute` (`packages/core/src/manager.ts:160`) and by docs scripts.
- Out: a `JobOutcome` (`job.ts:106`). The files `report.draft.json`, `report.json`, `report.html`, `metrics.drafted.json` and `diagnostics.json` on an engine bug. `JobEvent`s are pushed to listeners.
- Side effects: writes the job folder and its DuckDB tables (`job_stages`, `job_meta`, `events`, …), and deletes a workspace that never finished PROFILE. Model and web calls happen through deps.

**Main entry points.**
- `runJob` (`packages/core/src/job.ts:216`): defines the 13 stages and runs them.
- `runPipeline` (`packages/core/src/pipeline.ts:84`): the generic checkpoint and resume state machine.
- `JobManager` (`packages/core/src/manager.ts:69`): queue, status, wait, subscribe, confirm, resume, ask, explain, delete.
- `askJob` / `explainFact` (`packages/core/src/followup.ts:66`, `:117`): follow-ups on a finished report.
- `EventBus` (`packages/core/src/events.ts:11`) and `createLogger` (`packages/core/src/log.ts:24`).

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `packages/core/src/job.ts:220-231` | If a job fails in INGEST or PROFILE, the next run deletes the whole `job.duckdb`, because PROFILE is not "completed". That includes `job_meta` (the stored options and job id) and the event history. `aa run --resume <dir>` then passes no options (`apps/cli/src/main.ts:625`), so `runJob` throws `BAD_OPTIONS` ("a new job needs options"). This is the exact command the CLI prints after the failure (`apps/cli/src/run.ts:52`). Even when the resume works (the manager passes options and id again), the events table restarts at `seq` 0, so subscribers see repeated sequence numbers. | Keep `job_meta` and `events` when resetting: drop only the data tables, or let PROFILE's `reset` clean up. Or store options and the job id in a file next to `input/`, as `JobManager` does with `options.json`. Add a test: fail PROFILE, then resume with no options. |
| 2 | correctness risk | `packages/core/src/followup.ts:76` | `askJob` puts the user's question in as the scratch finding's `title`. `verifyReport` ends with an integrity check that rejects free numerals in titles (`packages/verify/src/verify.ts:463`). So any question with a digit that isn't a date, like "Why did revenue drop 10%?" or "What happened in Q2?", throws `VerifyError("UNVERIFIABLE")` whenever an answer claim survives. The API, MCP and CLI `ask` then return an error. The only test question has no digits (`packages/core/test/manager.test.ts:59`). | Use a fixed title for the scratch finding (for example "Follow-up answer"), since the question is not shown from it. Add a test with a numeric question. |
| 3 | complexity | `packages/core/src/followup.ts:87-90` | Each follow-up question verifies the *whole* report again. That means re-running every fact's SQL (V2), the V3 group-bys, the row checks and one judge call for every quoted claim already in the report, just to check one or two new claims. On a free-tier model this costs judge calls on every question. | Verify only the scratch finding: let `verifyReport` take a "claims to check" subset, or skip V2, V3 and the judge for findings already in `report.json`. |
| 4 | correctness risk | `packages/core/src/manager.ts:246-250` | `subscribe` sends the history first (`await this.events(id)`), and only then adds the listener. An event emitted by the running job in that gap is pushed into `live` after the snapshot was copied, and is not delivered to the new listener. A live view (SSE) can miss, for example, a `stage_completed` event. | Register the listener first while buffering, then replay the history and skip any `seq` already delivered. |
| 5 | duplication | `packages/core/src/manager.ts:51-65` | `STAGES` copies the stage order by hand. The same order also lives in `Stage` (`packages/schema/src/events.ts:4`) and in the `stages` array in `job.ts:260-614`. Progress is computed from this copy, so a stage that is added or reordered in one place and not the others makes the progress numbers wrong without any error. | Use `Stage.options` from the schema (its order is the pipeline order), or export the order from `job.ts`. |
| 6 | dead code | `packages/core/src/job.ts:424-429` | `const top = ranked;` is a pointless alias. The comment above it describes an ordering that is not done here (MEASURE already ranked the list). (The planner leak at `job.ts:430`, already reported, is next to it.) Similarly, `packages/core/src/pipeline.ts:95` says a skipped stage runs "once its feature exists (e.g. the verifier)", which is stale, and `packages/core/testing/coffee-planner.ts:339` is an orphaned doc comment directly above a second one. | Delete the alias and fix the comment to "kept in MEASURE's ranking order". Update the pipeline comment and remove the orphaned JSDoc. |
| 7 | missing test | `packages/core/test/resume.test.ts:70`, `:111` | The resume tests cover a kill during EXPLAIN and a failure in DECIDE. They don't cover the paths most likely to break: a failure before PROFILE completes (row 1), a resume while AWAIT_CONFIRM is paused, or a VERIFY that fails with a non-`VerifyError` (no `diagnostics.json`, `job.ts:594-601`). | Add one case per path. Each needs only a FakeModel step that throws. |

**Fine as it is.** The checkpoint design is simple and sound. Each stage records the first fact id it created, so undoing a partial stage is one `DELETE` plus a small `reset`. VERIFY deletes old outputs before it runs (`job.ts:564-565`). The `JobManager.wait` ordering is carefully commented. `EventBus` validates every event against the schema. Keep that structure. The fixes above are local.

### `apps/cli` — the `aa` command line: analyze, run, metrics, serve, mcp, jobs, eval, doctor, usage

**What it does.** This is the `aa` command (built with the `citty` library). Every other door starts from it: `aa serve` starts the HTTP API and `aa mcp` starts the MCP server. It reads `.env` and the config file, builds the model client, the embedder (the model that turns text into vectors for search) and a `JobManager`, then runs a job and prints each stage. `aa analyze` adds a review in the terminal where you accept, edit or drop each drafted metric. `aa doctor` checks the machine and `aa usage` adds up token counts from the call log. It does no analysis of its own: numbers are printed from the report's facts and never computed again.

**Data in → out.**
- In: file and folder paths and flags from the shell (`apps/cli/src/main.ts:203`, `:499`, `:594`), environment variables and `agentic-analytics.config.yaml` (`main.ts:39-41`), and review answers from stdin (`apps/cli/src/prompt.ts:27`).
- Out: text on stdout and stderr. A report copied to `<out>/agentic-analytics/report.{json,html}` (`apps/cli/src/analyze.ts:118-122`). A metrics YAML file with `--save` (`main.ts:531`). An exit code.
- Side effects: job folders under `AA_JOBS_DIR` (DuckDB files inside them), `data/logs/model-calls.jsonl` (`main.ts:80-89`), network calls to model providers, SearXNG and Docling (`apps/cli/src/doctor.ts:207`), a staged DuckDB library in the user's cache folder (`apps/cli/src/native-lib.ts:46`), and opening the HTML report with `--open` (`main.ts:225`).

**Main entry points.**
- `main` (`apps/cli/src/main.ts:669`): the citty command tree. `runtime()` (`:102`) wires models, the embedder, the web lane and the manager for most commands.
- `analyzeCommand` (`apps/cli/src/analyze.ts:66`): runs a job through the manager, with the interactive metric review loop.
- `runCommand` (`apps/cli/src/run.ts:31`): one job straight through `runJob`, with `--resume`.
- `runMetricsCommand` (`apps/cli/src/metrics.ts:52`): draft, review and compile metrics with no job folder.
- `runDoctor` / `usageCommand` (`apps/cli/src/doctor.ts:44`, `apps/cli/src/usage.ts:143`): the health check and the token report.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | duplication | `apps/cli/src/main.ts:592-666` | `aa run` rebuilds everything `runtime()` (`main.ts:102-149`) already builds: the planner profile, model client, embedder, SearXNG provider and engine block. The two copies have already drifted. `aa run` ignores `AA_DEMO_MODEL=scripted` (`main.ts:105`), so the "offline" demo flag quietly calls a real model there. It also hard-codes `version: "0.0.0"` (`main.ts:653`) instead of `ENGINE_VERSION` (`main.ts:72`). The cache-folder expression is copied three times (`main.ts:114`, `:429`, `:608`), and the SearXNG provider twice (`:131-136`, `:645-648`). | Have `aa run` take its model, embedder, engine and web lane from `runtime()`, and keep `runCommand` only for the folder and resume handling. |
| 2 | missing test | `apps/cli/src/main.ts:282-303` | `main.ts` (674 lines) has no test at all. The `serve` wiring matters for security: the token, `--allow-no-auth` / `AA_ALLOW_NO_AUTH`, the `allowedHosts` list built from `--host` and `AA_ALLOWED_HOSTS`, and `AA_MCP_ROOTS`. A slip there, such as dropping the token or allowing the wrong host, would still pass `bun run check`. | Move the option-building in `serve` (and the job-option mapping at `:211-217`) into small pure functions next to `standalone.ts`, and unit-test them as `standalone.test.ts` already does. |
| 3 | correctness risk | `apps/cli/src/main.ts:65-70` | `collect` follows symlinks (`statSync`) and has no cycle guard and no file cap. A folder with a symlink back to a parent recurses until the OS throws `ELOOP`, so the user gets a stack trace. A large tree is read fully into memory (`readFileSync`, `:210`). The MCP door's walker (`apps/mcp/src/server.ts:66-73`) already skips symlinks and caps the count. | Share one walker (MCP's, with the fix in the MCP section) between the CLI and MCP. |
| 4 | docs drift | `apps/cli/src/doctor.ts:45-46`, `apps/cli/src/main.ts:91-92`, `apps/cli/bin/aa.js:2` | The doctor comment says "5 s" but the timeout is `10_000`. `main.ts:91` is a leftover doc comment for `runtime()` stacked on top of `pickEmbedder`'s comment. `bin/aa.js:2` says "a bundled build replaces this in M10", but the bin still runs through tsx. The README "Status" line (`apps/cli/README.md`) still says `aa eval` "arrives in M11". | Fix the three comments and the README status line. |

(The model-without-screen call at `apps/cli/src/metrics.ts:71` is already reported and not repeated here.)

**Fine as it is.** `prompt.ts` (queued line reader with `ReviewEndedError`), `standalone.ts` and `native-lib.ts` are small, pure and well tested. They handle piped input, the binary's differences and the atomic library staging carefully. `doctor.ts` injects `fetch` and the model client, so it is tested with no network.

---

### `apps/server` — the HTTP API (Hono + zod-openapi), plus the viewer and `/mcp` mount

**What it does.** It exposes the job manager over HTTP: upload files, follow events over SSE (Server-Sent Events, a one-way stream of events over HTTP), review metrics, then get the report, ask follow-up questions and explain a number. Requests are checked against Zod schemas, and the same schemas generate `/openapi.json`. It guards against DNS rebinding with a Host/Origin allowlist (DNS rebinding is when a web page tricks the browser into sending requests to 127.0.0.1). It adds an optional bearer token compared in constant time, refuses to listen on a network address without a token, and hides internal error messages behind a generic 500. Each route is a thin call into the manager: no engine logic lives here. Upload file names are sanitized in core (`packages/core/src/manager.ts:126-134`), not here.

**Data in → out.**
- In: HTTP requests. A multipart upload with `files[]` and an `options` JSON (`apps/server/src/app.ts:163-185`), a YAML body for metric confirmation (`:279`), and JSON `{question}` (`:312`).
- Out: JSON status, report and answers, `report.html`, an SSE stream (`:225-247`), and static viewer files (`:418-441`).
- Side effects: through the manager it creates, resumes and deletes job folders. It reads `apps/viewer/dist`. A health check can call the planner model (`apps/cli/src/main.ts:265-281`, cached for one minute).

**Main entry points.**
- `createApp(manager, options)` (`apps/server/src/app.ts:87`): the Hono app with every route and middleware.
- `startServer(manager, options)` (`apps/server/src/serve.ts:24`): listens on Node, and refuses a non-loopback host without a token.
- `isLoopback(hostname)` (`apps/server/src/serve.ts:19`): the loopback check behind that refusal.
- `JobOptionsBody` (`apps/server/src/app.ts:52`): the strict schema for job options.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `apps/server/src/app.ts:99-103` | `onError` only knows `ManagerError`. Everything else becomes a 500 `INTERNAL` and is logged as an internal error, including Hono's own `HTTPException`s. So an upload over the limit (the `bodyLimit` at `:147` throws `HTTPException(413)`) returns "internal error" instead of 413. So does a wrong `Content-Type` on `/ask` (zod-openapi's media-type gate throws 415). The Telegram bot can hit this with 20×20 MB files, more than the 200 MB default. Clients can't tell "too big" from "server broken", and the log fills with false alarms. | In `onError`, return the right status for an `HTTPException` (as a `Problem` JSON with its status) before the generic 500. Add a test that uploads more than `maxUpload`. |
| 2 | correctness risk | `apps/server/src/app.ts:312`, `:328` | The `/ask` body is not marked `required: true`. In @hono/zod-openapi 1.6.3 an optional JSON body is only validated when the request says `Content-Type: application/json`. A POST with no Content-Type and no body skips validation, `c.req.valid("json")` is `{}`, and `manager.ask(id, undefined)` runs. That skips the `min(3)`/`max(500)` checks and sends a model call with an undefined question. | Add `required: true` to the `/ask` body (and to any future JSON body), and test a POST with no Content-Type. |
| 3 | correctness risk | `apps/server/src/app.ts:233-243` | Nothing catches a rejection from the SSE handler's `void manager.subscribe(...).then(...)`. If the job is deleted between the 404 check (`:224`) and `subscribe`, `dir()` throws `NOT_FOUND`. Any error reading the event history from `job.duckdb` (`packages/core/src/manager.ts:255-265`) does the same. That is an unhandled rejection, which ends a Node 22 process by default, and `finished` never resolves, so the stream hangs. A `DELETE` racing a `GET /events` can take the server down. | Add a `.catch` that writes one `failed`-style event (or just closes) and resolves `finished`. Test it with a manager whose `subscribe` rejects. |
| 4 | rule risk (security §4, defense in depth) | `apps/server/src/app.ts:300` | `report.html` is served from the API's own origin with no Content-Security-Policy. The report holds untrusted text (spreadsheet cells, document quotes) and runs an inline script (`packages/report/src/render.tsx:595-596`). The viewer keeps the bearer token in that same origin's `localStorage` (`apps/viewer/src/App.tsx:34-44`). The renderer escapes correctly today (`render.tsx:577-580`), so this is not an XSS today. But one escaping slip would turn into token theft plus `DELETE` access. The viewer's own iframe is sandboxed; this direct URL is not. | Send `Content-Security-Policy: sandbox allow-scripts` and `X-Content-Type-Options: nosniff` with the HTML report. The page then runs in an opaque origin, as it does inside the viewer. |
| 5 | duplication | `apps/server/src/app.ts:186-193` | The snake_case options are mapped to `JobOptions` by hand in three places: here, in `apps/mcp/src/server.ts:111-118` and in `apps/cli/src/main.ts:211-217`. The checks differ. HTTP caps `objective` at 500 characters and requires `currency` to be 3 letters (`app.ts:55-61`). MCP accepts any length of objective and any 3 characters (`apps/mcp/src/server.ts:96`, `:100`). The same job can be refused by one door and accepted by another. | Export one schema plus a `toJobOptions` mapper (from core or schema) and use it in all three doors. |
| 6 | correctness risk | `apps/server/src/app.ts:438-439` | The static handler serves any existing path that has an extension. A directory whose name has a dot makes `readFileSync` throw `EISDIR`, which becomes a 500. (Path traversal is handled correctly: `normalize` of an absolute path can't climb above `/`, and the tests at `apps/server/test/server.test.ts:151-181` cover encoded `..`.) | Check `statSync(file).isFile()` instead of `extname(file)`. |

**Fine as it is.** The security layer is well done: the Host/Origin allowlist (including the opaque `null` origin), constant-time token comparison, the network-bind refusal, a generic 500 with a log hook, health details only for the token holder, and job ids checked by regex here and again in the manager. All of it is tested in `server.test.ts:168-236`. Keep the routes this thin.

---

### `apps/mcp` — the MCP server (stdio for local clients, streamable HTTP at `/mcp`)

**What it does.** It gives MCP clients such as Claude Desktop five tools: `analyze_files`, `get_report`, `confirm_metrics`, `ask_report` and `explain_number`. It also offers two resources, the report as JSON and as HTML. (MCP, the Model Context Protocol, is a standard way for an AI app to call tools.) Every tool description tells the calling model to quote numbers and never recalculate them. Over stdio, the caller is the user's own client, so `analyze_files` may read any local path. Over HTTP, local paths are off unless `AA_MCP_ROOTS` names folders. In that case paths are resolved through symlinks and must stay inside a root. Like the other doors, it only calls the job manager.

**Data in → out.**
- In: JSON-RPC tool calls with Zod-checked arguments (`apps/mcp/src/server.ts:94-102`, `:131`, `:151`, `:167`, `:190`), and local file paths (`:108-110`).
- Out: MCP text content (summaries, JSON reports, answers, explanations) and tool errors (`:56-61`). Over HTTP, a `Response` per request (`apps/mcp/src/http.ts:7-14`).
- Side effects: reads local files inside the allowed roots. Creates jobs through the manager.

**Main entry points.**
- `createMcpServer(manager, options)` (`apps/mcp/src/server.ts:75`): registers the tools and resources.
- `mcpHttpHandler(manager, options)` (`apps/mcp/src/http.ts:7`): stateless streamable HTTP. It builds a fresh server per request, with roots `[]` by default.
- `serveStdio(manager, options)` (`apps/mcp/src/stdio.ts:7`): the stdio transport for `aa mcp`.
- `allowedPath(p, roots)` (`apps/mcp/src/server.ts:41`): the root check, done on real paths.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `apps/mcp/src/server.ts:66-73`, `:109-110` | The file cap applies to each path, not to the whole call. `collect(p, out = [])` gets a fresh `out` for every entry of `paths` (`:109`), and `paths` has no maximum length. So 1,000 paths with 500 files each all pass. There is also no byte limit: every file is read whole into memory (`:110`), while the HTTP upload door stops at 200 MB (`apps/server/src/app.ts:147`). With `AA_MCP_ROOTS` set, an HTTP caller can make the server load a whole shared folder tree. | Pass one shared `out` to every `collect` call, cap `paths`, and stop at a total byte budget that matches the server's `maxUpload`. |
| 2 | rule risk (security) | `apps/mcp/src/server.ts:58-61` | `fail()` sends `err.message` back to the caller for every error. Over HTTP that undoes the server's deliberate choice to hide internal messages (`apps/server/src/app.ts:99-103`, tested at `server.test.ts:214-225`). A DuckDB error from `explain_number` or `get_report`, or a filesystem error, reaches a network caller with job-folder paths or SQL. | Keep the message only for `ManagerError` and `PathNotAllowedError`. For anything else, return a generic text and send the details to a log hook (an `onError` option, as the server has). |
| 3 | missing test | `apps/mcp/test/roots.test.ts:103-109` | The tests check `allowedPath` on a symlink directly, but never the folder walk. Nothing tests that `collect` skips a symlink *inside* an allowed folder (the case `server.ts:68` exists for), or that the `MAX_FILES` cap fires. | Add a test that runs `analyze_files` on a root containing `link.csv` and checks the job's input has only `sales.csv`, plus one for the cap. |
| 4 | docs drift | `apps/mcp/README.md` ("Public API") | It lists `createMcpServer(manager, { today?, version? })`, `serveStdio(manager)` and `mcpHttpHandler(manager)`. It leaves out the `roots` option, the options argument of the other two, and the exported `allowedPath` and `PathNotAllowedError` (`apps/mcp/src/index.ts:4`). `roots` is the main security setting of this package. | List `roots` (with "any" for stdio and `[]` for HTTP), plus `allowedPath` and `PathNotAllowedError`. |

The options-validation drift (no objective cap, `currency` not checked as letters, `server.ts:96`, `:100`) is in the server's row 5.

**Fine as it is.** `allowedPath` is careful. It resolves real paths, guards against prefix look-alikes (`root-x`), skips roots that don't exist without leaking a path, and checks each file again at read time. It is tested for `../`, symlink escape and prefix tricks. The "quote, never recalculate" wording on every tool keeps the no-arithmetic rule visible to the calling model.

---

### `apps/telegram` — the Telegram demo bot (grammY, long polling) that talks to the HTTP API

**What it does.** A user sends files, then a question or `/analyze` (or puts the question in a file's caption). The bot uploads the files to the engine's HTTP API with `auto_confirm=true`. It edits one status message as stages pass, then replies with a short summary and `report.html` as a document. It talks to the engine only through the public API (`ApiClient`), as a remote user would. Access is limited to `TELEGRAM_ALLOWED_CHATS`, and the bot refuses to start without that list unless `TELEGRAM_PUBLIC=1`. It never does analysis, and it never shows raw error messages in the chat.

**Data in → out.**
- In: Telegram updates (documents, text, captions, commands) via long polling (`apps/telegram/src/bot.ts:104-129`). File bytes are downloaded from the Bot API (`bot.ts:44-50`).
- Out: Telegram messages and a `report.html` document (`bot.ts:80-84`). HTTP calls to the engine API (`apps/telegram/src/client.ts:46-92`).
- Side effects: network (Telegram and the engine API). Files are held in memory per chat until a job starts (`bot.ts:43`).

**Main entry points.**
- `createBot(token, api, options)` (`apps/telegram/src/bot.ts:41`): handlers, the allowlist middleware and the error catcher.
- `chatPolicy(env)` (`apps/telegram/src/bot.ts:137`): who may use the bot; it refuses an open bot unless that is explicit.
- `ApiClient` (`apps/telegram/src/client.ts:29`): `createJob`, `follow` (an SSE reader), `report` and `reportHtml`.
- `main.ts` (`apps/telegram/src/main.ts:1`): reads env and starts polling.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `apps/telegram/src/bot.ts:70`, `:105`, `:122`, `:128` | grammY's built-in `bot.start()` handles updates one at a time, and each handler `await`s `run()`, which waits for the whole job over SSE (minutes with a real model). While one job runs, the bot answers no one: not other allowed chats, not `/help`, and not the same user sending files for the next job. With `TELEGRAM_PUBLIC=1`, one stranger's job blocks everybody. | Start the job without awaiting it in the handler (keep a per-chat "busy" flag so a chat can't start two), or run updates concurrently with `@grammyjs/runner`. |
| 2 | correctness risk | `apps/telegram/src/bot.ts:122` | "A caption on a file starts the job right away" breaks for albums. When a user sends several files at once with one caption, Telegram puts the caption on the first file. The job starts with that file only, and the other files then sit in a new pending list. The user gets an analysis of one file. | Group documents by `media_group_id` and start only after the group is complete (a short debounce), or ignore the caption until the group ends. |
| 3 | correctness risk | `apps/telegram/src/bot.ts:43`, `:109-120` | `pending` holds up to 20 files × 20 MB per chat in memory, with no expiry and no total limit across chats. Files sent without a question stay forever. Twenty 20 MB files are also more than the server's 200 MB default (`apps/server/src/app.ts:147`), so the upload fails, and through the server's row 1 the user only sees "Something went wrong". | Add a byte budget per chat that matches the server's `maxUpload` (and say so in the reply), plus a time limit and a global cap on `pending`. |
| 4 | correctness risk | `apps/telegram/src/bot.ts:69`, `:128` | Any text message becomes the job's `objective`, but the API refuses an objective over 500 characters (`apps/server/src/app.ts:55`). A long question gets a 400, which the user sees only as "Something went wrong (details are in the bot's log)". | Check the length before calling the API and reply with the limit (or cut it to 500 and say so). |
| 5 | missing test | `apps/telegram/test/bot.test.ts:33-95` | Only the happy path, the allowlist and a failing reply are tested. Nothing covers the caption path, the `maxFiles` limit (`bot.ts:109`), a job that ends `failed` (`bot.ts:73-78`, where only the code reaches the chat), or `TELEGRAM_ALLOWED_CHATS` with junk values. | Add those cases with the same fake Bot API transformer. |
| 6 | docs drift | `apps/telegram/README.md:26` | The `createBot` options list leaves out `onError`, which is where every error now goes. | Add `onError` to the list. |

The SSE parser and request helper copied between `client.ts:35-82` and the viewer are listed once, in the viewer's row 2.

**Fine as it is.** The access policy is right: it refuses to start open by accident, tells a stranger their chat id, and keeps error details in the owner's log. File names from Telegram go to the API unchanged, and core reduces them to a safe base name (`packages/core/src/manager.ts:126-134`), so no traversal is possible here.

---

### `apps/viewer` — the web viewer (Vite + React): upload, live stages, metric confirmation, embedded report

**What it does.** A small single-page app served by `aa serve` at `/`. You choose files and an objective, then watch the pipeline stages light up as SSE events arrive. If you asked to review metrics, you edit the drafted YAML and confirm. When the job is done, the report is shown inside a sandboxed iframe. The live state is a pure reducer from job events, so it is tested without a browser. It reads SSE with `fetch` (not `EventSource`) so it can send the bearer token. It does no analysis and holds no data beyond the page.

**Data in → out.**
- In: user files and form fields (`apps/viewer/src/App.tsx:57-115`), the API's JSON and SSE (`apps/viewer/src/api.ts:14-72`), and the token from `localStorage["aa-token"]` (`App.tsx:34-40`).
- Out: API calls (create job, confirm metrics) and the rendered page. The report HTML goes into `<iframe srcDoc sandbox="allow-scripts">` (`App.tsx:156`).
- Side effects: network calls to the same-origin API only.

**Main entry points.**
- `App` (`apps/viewer/src/App.tsx:42`): hash routing between the upload page and a job page.
- `JobPage` / `MetricsForm` (`apps/viewer/src/App.tsx:131`, `:161`): the live view and the confirmation form.
- `createApi(base, token?, fetch?)` (`apps/viewer/src/api.ts:14`): the API client, including the SSE reader.
- `reduce(view, event)` / `initialView()` (`apps/viewer/src/state.ts:34`, `:30`): the pure job-state reducer.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | `apps/viewer/src/App.tsx:138`, `:142`, `:65` | Errors are swallowed (AGENTS.md §4: "never swallowed"). If the event stream fails (unknown job id, 401 because `API_TOKEN` is set, network down), `.catch(() => undefined)` leaves an all-"pending" pipeline frozen with no message. A failed `reportHtml` is ignored the same way, and a failed job list just shows nothing. When the API needs a token, the page has no way to enter one: the README says to set `localStorage["aa-token"]` by hand. | Put stream and report errors into the view (as `phase: "failed"` with the message). Show "a token is required" on a 401 and add a token field that writes `aa-token`. |
| 2 | duplication | `apps/viewer/src/api.ts:15-55` | The request helper (token header plus error-body parsing) and the SSE block parser are copied almost line for line in `apps/telegram/src/client.ts:35-82`. They have already drifted: the viewer throws a plain `Error` and drops the error `code`, while Telegram keeps it in `ApiError`. A fix to SSE parsing (for example `\r\n` line endings or multi-line `data:`) has to be made twice. | Move one fetch-only client (it uses web-standard APIs only, so it fits both the browser and Node) into a shared module that both apps import. |
| 3 | duplication | `apps/viewer/src/state.ts:4-18` | `STAGES` copies the `Stage` enum from `packages/schema/src/events.ts:4-18`, and core keeps a third copy (`packages/core/src/manager.ts:51`). The stage labels exist twice more (`App.tsx:8-21`, `apps/telegram/src/bot.ts:23-36`). Adding a stage means five edits, and a missed one fails silently (the stage never lights up). | Export a plain `readonly` stage array from `@agentic-analytics/schema`, so the viewer doesn't need to bundle zod for it, and derive all of these from it. |
| 4 | missing test | `apps/viewer/test/viewer.test.ts:55-63` | Only `Pipeline` and `UploadPage` are rendered in tests. `JobPage` (stream lifecycle, re-follow after confirming via `round`) and `MetricsForm` (load, edit, error) are not, and those are where row 1's bugs live. | Render them with a fake `Api` (and happy-dom, already a dev dependency) and check the failed-stream and confirm flows. |
| 5 | dead code | `apps/viewer/package.json:28` | `happy-dom` is a dev dependency that nothing in `apps/viewer` imports (it is only used in `packages/report/test/render.test.ts:4`). | Use it for the test in row 4, or remove it. |

**Fine as it is.** The report iframe is `sandbox="allow-scripts"` without `allow-same-origin`, so the report's script runs in an opaque origin. It can't read the token in `localStorage` or call the API with the viewer's credentials, and the server's CORS-off policy blocks reads from a `null` origin. React escapes every job id, file name, warning and metric text. Keep the reducer pure: it is the easiest part to test.

### `evals/runner` — runs the eval suites, scores each report against its answer key, and publishes RESULTS.md

**What it does.** This is the eval harness behind `aa eval`. For each dataset it runs a full engine job in a temporary folder and scores the finished `report.json` against the dataset's answer key. It then rolls the scores up into the "bars" of docs/EVALS.md §2 and writes a results JSON plus `evals/RESULTS.md`. A finding is matched to a planted event by its *subject*: the metric, member and periods read from the fact labels of its first claim, which code wrote. It never matches on wording, so a model can't score by saying the right words. It also runs the real-data tier (`real.ts`), carries a nightly run over two passes (`planResume`), and merges chunked runs. It does not judge citations itself: it copies the engine verifier's own counts.

**Data in → out.**
- In: `AnswerKey` and `Dataset` from `@agentic-analytics/eval-generator` (`suiteDatasets`, evals/runner/src/run.ts:18); a model factory plus an embedder from the CLI (`EvalDeps`, evals/runner/src/cli.ts:94; wired in apps/cli/src/main.ts:467); real-tier answer files via `parseRealAnswers` (evals/runner/src/real.ts:196).
- Out: `SuiteResult` / `RealSuiteResult` JSON in `evals/results/<date>-<model>-<suite>.json` and the `evals/RESULTS.md` page (cli.ts:280–283, cli.ts:344–345). It also returns the bars, which apps/cli/src/main.ts:485 turns into the exit code.
- Side effects: temporary job folders (DuckDB inside) created and removed per dataset (run.ts:281, run.ts:312); results files written, renamed to `.bad`, or deleted (cli.ts:208, 224, 282); optional kept reports and drafts (`--keep-reports`). Network only through the injected model client.

**Main entry points.**
- `evalCommand` (evals/runner/src/cli.ts:187): the `aa eval --suite smoke|full` command. Plans the pass, runs the suite, writes the files.
- `runSuite` (evals/runner/src/run.ts:276): runs every dataset as a job and scores it.
- `scoreReport` / `summarize` (evals/runner/src/score.ts:198, :296): one report against its key, then the suite bars.
- `planResume` / `mergeResults` (run.ts:160, :352): two-night carry-over and chunk merging.
- `runRealSuite` / `scoreCheck` (evals/runner/src/real.ts:225, :86): the real public-data tier.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | evals/runner/src/score.ts:276–278, :337–343 (counts made in packages/verify/src/verify.ts:302–321) | "Citation precision" and "Definition adherence" don't measure what EVALS §2 says. EVALS says precision is judged "by a separate judge and spot-checked by hand", and adherence is "facts matching confirmed definitions". Instead the scorer copies the verifier's in-pipeline counters. Those count the claims the verifier *dropped*, judged by the same judge role under test (the word-overlap judge for the baseline). Dropped claims never ship, so the shipped report is 100% by construction. The counters also stop at the first bad quote in a claim, and they skip citations with no quote. If a run checks no quotes at all, the bar is `undefined`, and apps/cli/src/main.ts:485 treats `pass !== false` as a pass. So a model that cites no quotes passes this bar by accident. The README status line and the landing strip headline this number. | Rename the two bars to what they measure (for example "Verifier drop rate: citations"), or add a real post-ship check with a separate judge. Make an `n/a` bar fail, or report it apart, when the denominator is zero. |
| 2 | correctness risk | evals/runner/src/score.ts:115–120 | `matchesPlanted` checks only metric, member and that the comparison spans the event period. It ignores the event's direction (`Planted.type: "regression"`) and size. So a finding that says revenue *rose* across the P1 month counts as finding the regression. A long comparison (first month → last month) also counts, as long as the driver matches. The real tier does check direction (real.ts:155), so the two tiers disagree. | Read the change's direction from the finding's measured points, as `directionOf` does in real.ts:68, and require it to match `p.type`. Add a test with an opposite-direction finding. |
| 3 | correctness risk | evals/runner/src/score.ts:273–275 | Quality-issue recall matches `kind` plus `file` only. Every key carries an exact `location` (for example `sales.xlsx#Costs!D9`, generate.ts:360), but the scorer never reads it. In v1 and v3, `sales.xlsx` holds both Orders and Costs. So a `unit_error` flagged on any column of either sheet satisfies Q1, even though the planted typo is one cell. | Compare the item's cited sheet and row (or column) with the key's `location`. Add a test where the right kind cites the wrong sheet. |
| 4 | correctness risk | evals/runner/src/score.ts:123–127 | The distractor FP rate undercounts. When a distractor has a `member` (D1, the blip on one counter customer), only a finding on that exact member counts. A total-revenue or channel-revenue finding at the blip month is the same false alarm seen one level up, but it isn't counted. This flatters the ≤ 10% bar. | When the distractor has a member, also count findings at its period on its metric with no member, or on that member's channel slice. |
| 5 | docs drift | evals/runner/src/score.ts:215, :315; evals/runner/src/real.ts:95–101; evals/runner/README.md ("Number mismatches … come from the report's verification summary") | "Number mismatches" can only be non-zero for a job that *failed* with a mismatch. A shipped report hard-codes `numbers_mismatched: 0` and `rederivation_mismatches: 0` (packages/verify/src/verify.ts:453–455). So the bar duplicates "Jobs completed". The real tier's `verified` check reads those two always-zero fields, which leaves only `definition_violations` (a count of dropped claims). The README's "0 wrong numbers" headline is therefore structural, not measured. A `CITATION_MISMATCH` failure (a V5 fact-row bug "like V2", verify.ts:136) isn't counted either. | Say in EVALS §2 and the runner README that the bar counts aborted jobs. Count `CITATION_MISMATCH` too. Drop or reword the real tier's `verified` check. |
| 6 | correctness risk | evals/runner/src/run.ts:515–520; evals/runner/scripts/rescore.ts:13–15 | `rescore` replaces each rescored `DatasetScore` with a fresh `scoreReport(...)`, which has no `routes`. So per-dataset routes and token usage are lost. A later `--passes` resume rebuilds routes from `kept.flatMap((s) => s.routes)` (run.ts:217), so usage silently shrinks. Separately, rescore.ts reads every `*.json` in the reports folder, including `<id>.metrics.drafted.json`. It parses those as reports and prints an inflated "rescored N report(s)". | Spread the old score's `routes` into the rescored one. Filter out `.metrics.drafted.json` in rescore.ts. |
| 7 | correctness risk | evals/runner/src/real.ts:252 | For a public dataset, the result's `sha256`, printed in RESULTS.md as "File read: … SHA-256", is the manifest's constant. It is not the hash of the bytes read at real.ts:243. If someone edits the derived file after `eval:real:fetch`, the published line still claims the pinned checksum. "Your own data" already hashes the bytes it read (real.ts:254). | Hash `bytes` for public datasets too, and fail (or mark the result) when the hash differs from `meta.derived.sha256`. |
| 8 | duplication | evals/runner/src/real.ts:55 vs evals/runner/src/score.ts:17–18 | Two regexes parse the same `<metric>[dim=member]_<period>` fact label. score.ts also accepts quarters and weeks, but then truncates every period to 7 characters (score.ts:39, :41), so `2026-W12` becomes `2026-W1`. real.ts accepts months only. A label format change has to be made in both places. | Export one label parser from score.ts (with a correct period type) and use it in real.ts. |

**Fine as it is.** Matching findings by their code-written subject rather than their wording is the right design, and its tests use hand-computed bars (evals/runner/test/score.test.ts:193). The pass carry-over logic (`planResume`) is careful and well tested: it checks role models before spending quota, closes stale runs, and refuses same-day overwrites (passes.test.ts).

---

### `evals/generator` — seeded generator of the 30 synthetic businesses and their answer keys

**What it does.** It builds 10 archetypes × 3 variants of a small business: monthly orders from integer cents and a seeded random number generator, cost sheets, and documents (an email, a price notice, ops notes, a launch plan, distractor notes). It then *plants* known events and writes an answer key for each. The planted events are a key client lost after a price rise (P1), refunds rising after a supplier switch (P2), a new product cannibalizing an old one (P3), a ×1000 typo (Q1), date ambiguity (Q2), a noise blip (D1), and December peaks (D2+). The files are byte-identical on every build, pinned by `manifest.json`. It does not score anything, and it doesn't yet plant the Simpson's-paradox or concentration-risk setups.

**Data in → out.**
- In: an `Archetype` (evals/generator/src/archetypes.ts:5) and a variant number. Nothing external.
- Out: `Dataset { id, answers: AnswerKey, files }` in memory (generate.ts:125, :391). The runner (run.ts:18) and generate's own tests consume it. `scripts/build.ts` writes `evals/datasets/generated/<id>/{files,answers.yaml}` and `manifest.json`.
- Side effects: none in `src/`. The build script writes files (evals/generator/scripts/build.ts:10–16).

**Main entry points.**
- `generateDataset(archetype, variant, seed?)` (evals/generator/src/generate.ts:125): one business and its key.
- `generatedDatasets()` (generate.ts:391): all 30.
- `answersYaml` / `manifest` (generate.ts:395, :400): the versioned key and the file-hash pin.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | correctness risk | evals/generator/src/generate.ts:143, :157, :152 | The noise blip D1 is planted at index `n − 7`, which is 2025-12 in every variant. In v3 that is also a planted December peak. The counter channel, which holds D1's customer, is ×1.25 that month (generate.ts:152). So in v3 the "3% blip inside the noise band" sits on a real +25% seasonal move for the same member, and D1 and D3 share a period (see evals/datasets/generated/saas-v3/answers.yaml:58, :75). D1 no longer tests "noise inside the band" there. | Move the blip to a non-December month (for example `n − 6`), then rebuild the keys and manifest with a note in the PR, as EVALS §5 asks. |
| 2 | missing test | evals/generator/test/generate.test.ts:27–47 | Only saas-v2's P1 and P2 are checked against the generated rows. Nothing checks that P3's old product really loses most of its sales from its month, that the December peaks exist, or where D1's blip lands. A change in the generator could break P3 and D2 and still pass, because the manifest test would simply be re-pinned. | Add data checks for a v3 dataset: the old product's share before and after `C`, December against its neighbours, and the blip's member and month. |
| 3 | docs drift | docs/EVALS.md:37, :45–62; evals/generator/src/generate.ts:30, :40 | EVALS §1 shows an answer key with `expected_change_pct`, `tolerance_pct` and a quality `location` that is scored. It also says "the golden set (hand-reviewed) is 10 of them". None of this exists: generated keys have no expected change, `location` is never scored, and there is no golden set. `Planted.type` and `Planted.persists` are written into every key but read by no code (grep finds them only in generate.ts and a test fixture). | Update the EVALS §1 example to the real `AnswerKey` shape and drop the golden-set sentence, or start using `type` and `persists` (see runner #2). |
| 4 | unclear name | evals/generator/src/generate.ts:381 vs :19 | `today: "2026-07-01"` is typed by hand, but the series end comes from `END = { year: 2026, month: 6 }`. Change one without the other and every job's "today" falls inside or far from the data. | Derive `today` from `END` (the first day of the next month). |

**Fine as it is.** It is deterministic from integer cents with a seeded generator, and both the files and the YAML keys are pinned and tested. The typo test reads the exact cell named by the key (generate.test.ts:49). Keep that approach.

---

### `evals/datasets` — the hand-built datasets (coffee-roaster-v1, printing-shop-v1), the injection fixtures, and small file writers

**What it does.** It holds the hand-built golden dataset coffee-roaster-v1: a monthly ground-truth table in integer cents, orders generated to add up to it *exactly*, a price-list PDF, an email and ops notes. It also holds `buildGoldenReport`, the reference report fixture. printing-shop-v1 is a 47-file document corpus used by the retrieval eval. `injectionFixtures` builds the 20+ poisoned inputs of the security suite. It ships tiny deterministic writers for PDF, ZIP/DOCX and EML so fixtures never drift. The eval runner does not score these datasets; they feed unit tests, the docs and the retrieval/injection suites.

**Data in → out.**
- In: nothing at runtime. The ground truth is constants (evals/datasets/src/coffee-roaster.ts:25).
- Out: file bytes by name (`coffeeRoasterFiles`, evals/datasets/src/index.ts:14; `printingShopFiles`, printing-shop.ts:337; `injectionFixtures`, injection.ts:57) and the golden `Report` (golden-report.ts:38). Consumers include packages/core tests, apps/docs/scripts, scripts/test and the generator (which imports `docx`, `eml`, `textPdf`, `allocate`, `rng`).
- Side effects: none in `src/`. The build scripts write `coffee-roaster-v1/files`, `printing-shop-v1/files` and `evals/injection/fixtures`.

**Main entry points.**
- `coffeeRoasterFiles()` / `goldenReportJson()` (evals/datasets/src/index.ts:14, :29).
- `injectionFixtures()` (evals/datasets/src/injection.ts:57).
- `textPdf`, `zipStored`, `docx`, `eml` (pdf.ts:12, zip.ts:23, printing-shop.ts:15, :30): the deterministic writers.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | duplication | evals/datasets/src/documents.ts:62–77 vs evals/datasets/src/printing-shop.ts:12–28; documents.ts:33–44 vs printing-shop.ts:30–45 | `opsNotesDocx` re-implements the generic `docx()` writer, including its own `xmlEscape`. `EMAIL_EML` re-implements `eml()`'s headers by hand. Meanwhile injection.ts:6 and the generator import `docx`/`eml` from `printing-shop.ts`, a dataset file, so shared writers live inside one dataset. | Move `docx`, `eml` and `xmlEscape` into a `writers.ts` next to pdf.ts and zip.ts. Build the coffee-roaster DOCX and EML through them, keeping the bytes identical (the hash tests will confirm). |
| 2 | docs drift | evals/datasets/README.md (whole "Public API" section) | The README describes only coffee-roaster-v1. It doesn't mention printing-shop-v1, the injection fixtures (`injectionFixtures`, `build:injection`), or the `docx`/`eml`/`allocate`/`rng` helpers the generator depends on. | Add a short section for each and list the full export set from src/index.ts. |
| 3 | unclear name | evals/datasets/src/coffee-roaster.ts:5–12 | `DatasetError.code` is a plain `string`. Other packages type their codes as unions (for example `RealDataError`, evals/real/src/errors.ts:4), as AGENTS.md §4 asks. | Type the code as a union of the codes actually thrown (`MISSING_COST_ROW`, `PDF_NON_ASCII`, …). |

**Fine as it is.** The "orders add up exactly to the monthly table" design, with its hash-pinned rebuild tests (coffee-roaster.test.ts:27–115), is excellent. The quote and span checks against the source text keep the golden report honest.

---

### `evals/real` — downloads and checksums the public datasets, derives the files the engine reads, and defines the answer-file schema

**What it does.** For each public dataset (UCI Online Retail II, Stats NZ card spend), it downloads the archive and verifies the SHA-256 of the download, of the archive entry, and of a deterministically derived file. It writes them to the gitignored `evals/real/data/`. It also defines the Zod schema for the answer files (`answers/*.yaml`), whose expected numbers come from SQL written in the file. Running and scoring live in evals/runner (`real.ts`). It never commits data, and every side effect of `fetchDataset` is injected, so the tests use no network.

**Data in → out.**
- In: `RealDataset` entries (evals/real/src/manifest.ts:34) and injected `fetch`/`read`/`write`/`print` (fetch.ts:28–33); answer YAML text for `parseRealAnswers` (answers.ts:89).
- Out: `Fetched` (fetch.ts:36) and the derived file written through `deps.write`; a parsed `RealAnswers` for the runner (evals/runner/src/real.ts:200).
- Side effects: network download and file writes, only in evals/real/scripts/fetch.ts:24–29.

**Main entry points.**
- `fetchDataset` (evals/real/src/fetch.ts:47): download, verify, derive, verify.
- `deriveOnlineRetailSample` / `deriveCardSpendByIndustry` (evals/real/src/derive.ts:34, :65): pure derivations.
- `parseRealAnswers` / `RealCheck` (evals/real/src/answers.ts:89, :63).
- `REAL_DATASETS` (evals/real/src/manifest.ts:34).

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | dead code | evals/real/src/manifest.ts:18, :49, :76; evals/real/src/fetch.ts:62–64 | `download.bytes` is recorded for each dataset but never read. Meanwhile the fetch reads the whole response into memory with no size cap and no timeout. A stalled or oversized download hangs or fills RAM before the checksum can refuse it, which matters on the maintainer's memory-limited laptop (AGENTS.md §9). | Use `download.bytes` as a guard (check the `content-length` header, or stop reading past it) and add a fetch timeout, or delete the field. |
| 2 | docs drift | evals/real/README.md:58 | The README lists `RealDataError` codes `DOWNLOAD_FAILED`, `CHECKSUM_MISMATCH`, `ENTRY_MISSING`, but `deriveOnlineRetailSample` also throws `UNEXPECTED_LAYOUT` (derive.ts:43; errors.ts:4). | Add `UNEXPECTED_LAYOUT` to the list. |
| 3 | correctness risk | evals/real/src/derive.ts:68 | The filter `/^ECTM\.S1GA\d,/` accepts series S1GA0 and S1GA9, but the doc and manifest say S1GA1–8 (derive.ts:61, manifest.ts:83). Today the checksum pins the output, so a new upstream release would fail loudly rather than drift. Still, the code does not say what it means. | Use `[1-8]` so the code matches the documented slice. |
| 4 | dead code | evals/real/package.json (`@agentic-analytics/schema` dependency) | No file in evals/real imports `@agentic-analytics/schema` (grep finds none; knip flags it too). | Remove the dependency. |

The real tier's scoring gaps (the `verified` check reading always-zero fields, and the result's SHA-256 not being of the bytes read) live in evals/runner/src/real.ts; see runner #5 and #7.

**Fine as it is.** Three-level checksum verification, with derivations that are pure functions and side effects injected, is solid and well tested (evals/real/test/fetch.test.ts:75–214). So is the rule that every expected number has its SQL written next to it in the answer file.

---

### `scripts/` (build and ops) — the gate, the machine-wide heavy-job lock, the nightly eval pass, notifications, and generated-file checks

**What it does.** These are the repo's own tools, not product code. `gate.sh` is the pre-push quality gate. `heavy.sh` serializes heavy jobs across worktrees with `flock` and waits for free RAM (AGENTS.md §9). `eval-daily.sh` runs one real-model eval pass a night and sends a summary through `notify.sh` (Telegram, optional). `schema-drift.ts` and `prompts-gen.ts` check that generated JSON Schema and inlined prompts match their sources. `readme-assets/*` generates the README tables, status line, hero SVGs and GIF checks from committed results. The other scripts (`autopilot.sh`, `check-bun-runtime.sh`, `hooks/*`, `build-binary.ts`) were read for context only.

**Data in → out.**
- In: the repo tree; `evals/results/*.json` (assets.ts:62–198); `packages/agent/prompts/*.md` (prompts-gen.ts:9); Zod schemas (schema-drift.ts:5); `AA_TG_TOKEN`/`AA_TG_CHAT` from the environment or `~/.config/agentic-analytics/telegram.env` (notify.sh:7–20).
- Out: exit codes for `bun run check`; generated README.md, docs/ARCHITECTURE.md, evals/RESULTS.md and hero SVGs (assets.ts:316); per-day logs in `data/logs/` (eval-daily.sh:33); one Telegram message.
- Side effects: a lock file in `/tmp` (heavy.sh:27), network (notify.sh:22), file writes, `ffmpeg`/Playwright child processes (readme-assets).

**Main entry points.**
- `scripts/gate.sh` (whole file): install, then `bun run check`, under the heavy lock.
- `scripts/heavy.sh` (whole file): run one heavy command at a time.
- `scripts/eval-daily.sh` (whole file): the nightly pass and its summary.
- `scripts/readme-assets/assets.ts` (`expected`, :204; `check`, :280): README and RESULTS.md generation and drift check.
- `scripts/schema-drift.ts`, `scripts/prompts-gen.ts`: the generated-file checks inside `bun run check`.

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | rule risk | scripts/notify.sh:22 | The bot token is placed in curl's command line (`https://api.telegram.org/bot${AA_TG_TOKEN}/…`). The script never prints it, but while curl runs, any local user can read the token from `ps` or `/proc/<pid>/cmdline`. The script also has no `set -u` / `pipefail`, and no `--max-time`, so a hung Telegram call blocks `eval-daily.sh` and `autopilot.sh`. | Pass the URL to curl through stdin (`curl --config -` / `-K -`) so the token never appears in argv. Add `--max-time 15` and `set -uo pipefail`. |
| 2 | correctness risk | scripts/eval-daily.sh:33, :36–37, :41–43 | The log is one file per UTC day, opened in append mode (`tee -a`, `>>`). The job counts then grep the *whole* file. A second run the same day (allowed: "a same-day rerun starts again", run.ts:197) adds its `[i/n]` lines to the first run's, so the summary and Telegram message double-count jobs, rate-limit stops and failures. | Write each run to its own log (add the time to the name), or count only the lines after this run's header line. |
| 3 | correctness risk | scripts/eval-daily.sh:28–29, :40 | The script uses `set -uo pipefail` without `-e` (on purpose, to keep the eval's status), but `cd "$(dirname "$0")/.."` isn't checked: if it fails, the script runs `bun run eval` and writes `data/logs` in whatever folder cron started in. `bun run readme:assets >/dev/null 2>&1 \|\| true` hides every failure. It also rewrites tracked README.md and docs/ARCHITECTURE.md on whatever branch the checkout is on, after the heavy lock has been released. | Use `cd … \|\| exit 1`. Run readme:assets through `heavy.sh`, log its output, and put its failure in the summary. |
| 4 | dead code | scripts/gate.sh:18–19 (with package.json:17–41) | The root package.json has no `build` or `eval:smoke` script, so both gate steps never run (the smoke suite runs inside `vitest run` as evals/runner/test/smoke.test.ts). The header says "Same checks CI runs", but CI also runs `aa doctor`, `docker compose config` and the browser checks (.github/workflows/ci.yml:33–87). | Delete the two dead lines and reword the header ("the checks of `bun run check`"), or add the missing steps. |
| 5 | docs drift | scripts/readme-assets/assets.ts:190 (vs :156 and apps/docs/scripts/generate.ts:230–236) | The README status line hard-codes "500+ tests run with no model or key", in a block whose own comment says "Every number comes from the committed results files". The landing page computes its test-file count from vitest's globs, so the two pages can disagree. | Compute the count the way generate.ts does (or pass it in), or drop the number. |
| 6 | duplication | scripts/readme-assets/assets.ts:46–56, :111–123; apps/docs/scripts/generate.ts:206; evals/runner/src/cli.ts:354–361 | Four readers parse `evals/results/*.json`, each with its own hand-written partial type (`ResultFile`, `RealResultFile`, `SuiteFile`), and none validates the parsed data. One malformed `.json` in the folder crashes `aa eval` after the results file is written but before RESULTS.md (cli.ts:360). It also crashes `readme:check` and the docs build. Only the row's own previous file is guarded (`readPrevious`, cli.ts:73). | Export one `readResults(dir)` from evals/runner that validates (reusing `readPrevious`'s checks) and skips or reports bad files, and import the `SuiteResult`/`RealSuiteResult` types instead of redeclaring them. |
| 7 | correctness risk | scripts/prompts-gen.ts:49–65 | With no mode, or a typo like `--chek`, the script does nothing and exits 0. `prompts:check` passes `--check` correctly today, but the failure mode is silent. | Exit 2 with a usage line for any mode other than `--write` or `--check`. |
| 8 | correctness risk | scripts/readme-assets/report-clip.ts:176–197; scripts/readme-assets/demo.sh:58 | report-clip.ts has no `try/finally`, so a failed locator leaves Chromium running (AGENTS.md §9 asks to clean up leftovers). pipeline-gif.ts does it right (:115–158). demo.sh ends with `find "$ROOT/agentic-analytics" -delete`, which deletes the default report folder in the repo root, including one the maintainer made earlier by hand. | Wrap report-clip's body in `try/finally { browser.close() }`. Have the tape write its report to a folder under `$WORK` and delete only that. |

**Fine as it is.** `heavy.sh` is careful: `set -euo pipefail`, quoted variables, a nested-call bypass, an `--if-free` exit 75 for the Stop hook, holder PIDs in the wait message, a validated `AA_HEAVY_MIN_MB`, and a test (scripts/test/heavy.test.ts). notify.sh's env-file parsing, which reads only two keys and never `source`s the file, is also the right call. `schema-drift.ts` is small and correct.

---

### `apps/docs/scripts` (data scripts only) — generate the docs site's data from real offline engine runs

**What it does.** These scripts make sure nothing on the docs site is typed by hand. `generate.ts` runs the real engine on the coffee-roaster example with the scripted planner and writes the islands' JSON. It also writes the HTTP API page from the server's own OpenAPI spec, the report-schema page from the JSON Schema, and the eval numbers via the runner's own `summarize()`. `pipeline-data.ts`, `landing-data.ts` and `learn-data.ts` record one web-enabled run (plus CLI, MCP and router sessions) into checked-in JSON. `site-assets.ts` renders og.png and favicon.ico with a recorded input hash. The site's components were not reviewed (the site is design-frozen).

**Data in → out.**
- In: `coffeeRoasterFiles()` and `coffeePlanner()`/`coffeeWeb()` (offline), `evals/results/*.json`, `CHANGELOG.md`, `packages/schema/json/report.schema.json`.
- Out: `apps/docs/src/data/*.json` and generated content pages (gitignored, generate.ts:36–42); checked-in `docs/assets/readme/pipeline.json` (pipeline-data.ts:233) and `docs/assets/learn/learn.json` (learn-data.ts:1173); `public/og.png`, `public/favicon.ico` and `scripts/site-assets.json`.
- Side effects: temporary job folders and DuckDB files (removed in `finally`), spawned `aa` processes (learn-data.ts:510), Playwright Chromium (site-assets.ts:84).

**Main entry points.**
- `apps/docs/scripts/generate.ts` (whole file): runs before every docs build.
- `recordRun` / `extractPipelineData` (apps/docs/scripts/pipeline-data.ts:198, :55).
- `landingData` / `statusStrip` (apps/docs/scripts/landing-data.ts:20, :447).
- `recordLearn` (apps/docs/scripts/learn-data.ts:1137).

**Top issues, ranked by impact.**

| # | Kind | Where | What's wrong | Suggested fix |
|---|---|---|---|---|
| 1 | dead code | apps/docs/scripts/pipeline-data.ts:158–163 | `from: shown(sqlFacts[0] ?? byFn("delta"))` and `to: shown(sqlFacts[1] ?? byFn("delta"))` fall back to the *delta* fact, which would show a change as a level. The fallback can never take effect: `fromPeriod`/`period` call `need(...)` on the same `sqlFacts[0]`/`[1]` and throw first. The code also assumes the claim lists the earlier period first. | Drop the fallbacks and `need()` the two SQL facts explicitly, ordered by their period rather than by claim order. |
| 2 | docs drift | apps/docs/scripts/generate.ts:127–131 | The generated "HTTP API" page carries hand-written security bullets (allowed hosts, `API_TOKEN`, `--allow-no-auth`) inside a page whose header says it is generated and must not drift. The table is generated; this prose is not. | Move the bullets to a hand-written page the generated one links to, or derive them from the server's options. |
| 3 | unclear name | apps/docs/scripts/generate.ts:203 | `latest()` throws a plain `Error` while every other failure in these scripts is typed (`LandingDataError`, `PipelineDataError`, `LearnDataError`), against AGENTS.md §4. | Throw `LandingDataError` (or a `DocsDataError`) with a code. |

The duplicated results-file types (`SuiteFile`, generate.ts:206) are covered in the scripts section, row 6.

**Fine as it is.** Recording every on-screen number from a real offline run and failing the build when the landing page and pipeline.json disagree (generate.ts:188–189) is exactly right. So is having site-assets record an input hash plus output hashes, so a hand-edited manifest can't pass.
