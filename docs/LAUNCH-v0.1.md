# v0.1 launch: the final review and what's left for the maintainer

The final v0.1 review is done (AGENTS.md §9, "The v0.1 finish plan"), and so are the backtest's pre-tag fixes and the final hands-on check (§1b, §1c). This page says what was checked and fixed, the decisions only the maintainer can make, and the launch steps. The public, irreversible steps themselves are in [LAUNCH.md](LAUNCH.md). **Work stops here until the maintainer says yes to the v0.1.0 tag.**

## 1. What the final review did

| Check | Result | PRs |
|---|---|---|
| Split files over 1,000 lines (behaviour unchanged) | The browser suite by section, the landing page into section components, the Learn data recorder by stage, Exhibit and EngineMachine into markup and script modules | #129, #132, #133, #134 |
| Code review, whole codebase | 8 findings: 7 fixed (concurrent job claims, a half-written `status.json`, upload names, SSE streams that never end, uncaught listen errors, redirects without `Location`, `--today` off the calendar), 1 dismissed (PVM on large dimensions: these bucket into "(other)") | #136 |
| Security review, whole codebase | 2 fixed with tests: ZIP bombs, where the 300 MB limit is now measured on real inflated bytes and the parsers' own header reads can't be fooled; and a quadratic HTML scanner, now linear. Hardening: a read-only CI token, and a `.env` read from outside the repo is now named. Sound: auth and the Host guard, SQL parameters, SSRF, quarantine, report XSS, the viewer sandbox, MCP roots, Telegram, key masking, no secrets in git | #135, #137 |
| Spec against code | The HTTP API, MCP, report schema, model settings and analysis methods match. Fixed: the CLI table, `JOB_TTL_DAYS` (documented, never built: now "not in v0.1"), and the unsent `model_usage` event | #138 |
| Docs and README accuracy | Every README link, `bun run` script, `aa` command and flag exists | none needed |
| Fresh clone, install and quickstart | PASS: `bun install`, `aa doctor`, and with the scripted planner a full report in 8 s. Docker compose and the release binaries were not run here (CI builds the binaries on every PR; the image is first built by the release workflow) | none needed |
| Carried follow-ups | Test timing and a hermetic learn test (#126); scripted planner in small-model mode (#130); closed runs only in the README (#131); the pack-id rebind is pinned by a test (this PR). The rest are recorded in STATE "Known gaps" (none changes a number) | #126, #130, #131 |

`scripts/gate.sh` and CI were green on every merge.

## 1b. Pre-tag fixes from the real-data backtest (2026-11-11 to 11-12)

The backtest on public data (openinfo.uz company reports, SIAT tourism and retail statistics, three SEC EDGAR food companies, Inside Airbnb Istanbul) found false all-clears, lost units and silent gaps an owner would hit on a first try. All seven "Before v0.1 tag" items were fixed. Each was its own PR with tests that fail on main; engine PRs got the spec-reviewer and QA:

| Item | What changed | PR |
|---|---|---|
| File messages | `.gz`, files over a size limit (per file or per job) and text files with control characters each get one plain sentence naming the file and the fix, under "Files not read" | #140 |
| No numbers read | A job that computes no number says "No numbers could be read from these files: <reason>", never "No material changes"; `aa analyze` exits 2 | #141 |
| Dropped recommendations | When no recommendation survives, the report and CLI say why, and that the findings still stand | #142 |
| Units | thousand/million/billion and currency words in a header are named with every value ("17,776,691.70 million UZS"), never multiplied in; numbers formatted; a model can't set the scale | #143 |
| Guards | Rows after `--today` are not history (a partly-future period is dropped whole; year+month tables capped); negative sales amounts without a refund marker and falling cumulative/YTD columns are flagged | #144 |
| Caveats | "Amounts are nominal, not adjusted for inflation" once per money report; a November→December change carries "December is often a seasonal peak; compare it with December of last year" under the finding (the year-on-year number is v0.2) | #145 |
| Docs | The docs page "Which files work in v0.1" (header words from the code, what isn't read yet); the README and site promise tidy CSV/Excel tables with documents as evidence, not "any data" | #146 |

Re-run of every raw and clean scripted-baseline backtest job on the merged engine (data/backtests/REPORT.md §7, local):
- **False all-clears:** 17 before, 0 after. Every job that reads nothing says why, and exits 2.
- **Honest headers now read:** retail `retail_turnover_mln_uzs` and the SEC `revenue_usd`-style headers now produce findings, with units shown.
- **Guards:** the Airbnb period no longer runs past `--today`, and the negative retail month is flagged.
- **Caveats:** they appear where they should.
- **Unchanged:** finding counts and values on the engine-words runs.

## 1c. Final hands-on check (2026-11-12, main at ef11a68)

| Step | Result | Notes |
|---|---|---|
| B1 Fresh clone, README quickstart | **PASS, with the scripted model** | `git clone`, `bun install` and `aa doctor` ran as written. The README's `aa analyze examples/coffee-roaster …` ran every stage through INDEX_DOCS, then stopped at EXPLAIN with a clear message and an `aa jobs resume` line, because no model was reachable. The agent's sandbox can't read the local `.env` holding the Groq key, so the configured run wasn't possible. The same example with the scripted model gave a full report in 8.7 s: 3 findings, 2 recommendations, the nominal note, every number verified. Groq quota untouched. |
| B2 Report, headless, 1440 and 390 wide | **PASS, with 3 cosmetic defects** | The summary reads clearly at both widths. Clicking a number opens its panel (value, metric, SQL, "re-derived by the verifier"). Its citation highlights the 15 source rows. No horizontal overflow, no page errors. Defects: (1) in the number panel, the citation pill listing the rows (`r2025,r2026,…`) runs past the panel's right edge; (2) "Exact value" shows float noise (`44100.000000000065 USD`); (3) the metric line repeats "(assumed) (assumed)". Screenshots: desktop/phone top, number panel and source rows. |
| B3 `aa serve`, upload in the viewer | **PARTIAL** | From the fresh clone, `aa serve` first says "The viewer is not built: run `bun run --filter @agentic-analytics/viewer build`". The README quickstart doesn't mention this step (Docker does it). After the build: the example upload (4 files) ran through to the confirmation screen, then to EXPLAIN, and stopped there with the provider error shown in the viewer (no model). A documents-only upload with review off ran to a report in 9 s ("No numbers could be read … no table was found"). **Bug:** with review on (the default), a documents-only upload stops on an empty confirmation screen, and "Confirm and continue" answers "no metric definitions given". |
| B4 Live site, real Chrome, 60 s through the 3D machine | **PASS** | Load 1.4 s. 3,599 frames in 60.1 s, an average of 59.9 FPS. 95th-percentile frame 16.7 ms, worst 67 ms; no frame over 100 ms, no long tasks, no freeze. JS heap 3.1–7.5 MB (6.4 MB used at the end). The machine rendered; the live hero shows the #146 wording. |

Found in this check and not fixed (none changes a number; small, can go in before the tag if the maintainer wants):
- **B2:** the number panel's citation pill overflows; "Exact value" shows float noise; "(assumed)" is printed twice.
- **B3:** the README quickstart doesn't say to build the viewer before `aa serve`; a documents-only upload with review on dead-ends at an empty confirmation.

## 2. Decisions for the maintainer

1. **The v0.1.0 tag.** Say yes, and then follow §3.
2. **Which nightly run the README and landing page show.** (Update 2026-11-12: more closed runs now sit uncommitted in the main checkout: `2026-11-03`, `2026-11-05` and `2026-11-10`. The main checkout, which the 03:00 nightly runs from, is still at 3be7f9b: the nightly scores the engine from before the pre-tag fixes until it's moved to main.) The README table and the landing page show the latest *closed* nightly run (#131). Today that is 2026-10-23: 28 of 30 jobs finished, planted recall@5 84%.
   - **What's waiting:** the 2026-10-31 03:00 nightly closed the 2026-10-27 run as partial (11 of 30 jobs, recall@5 30%). Of its 19 unfinished jobs, 17 hit the Groq free tier's rate limit and 2 failed output validation. It also started a 2026-10-30 run: 9 of 30 after one pass, with 14 "Cannot connect to API" errors and 7 rate limits.
   - **Where it sits:** those results are uncommitted in the main checkout (`README.md`, `evals/RESULTS.md`, `evals/results/2026-10-27-…json`, a new `2026-10-30-…json`). The review left them untouched.
   - **The effect of committing them:** the landing page's headline row becomes the 11-of-30 run.
   - **Options:**
     - **(a)** Commit them as they are. The page stays honest, but the headline weakens.
     - **(b) Recommended.** Wait for tonight's second pass to close the 2026-10-30 run, then commit whatever it shows, with a RESULTS note that most of the 10-27 misses were the free tier's rate limit, not the engine.
     - **(c)** Keep the 10-23 run as the published one. This is selective, and not recommended.
3. **Security gaps to accept or fix before going public.** All are recorded in STATE "Known gaps carried forward". None is reachable from a file or a web page with the defaults (localhost, no web lane):
   - The engine image runs as root. `USER node` needs a build-and-run check first.
   - Inside the compose network, sibling containers can call the API without a token. Only the optional services the compose file starts are siblings.
   - Docling keeps outbound network access, because it downloads its models.
   - Parsing doesn't run in killable worker threads, so the 60 s timeout can't stop a pathological xlsx or CSV.
   - A file with more than 1,000 ZIP entries is refused.
4. **Real-model acceptance checks still DEFERRED** (STATE "Deferred checks"). The main one is the M15 A4 bars (golden kpi, margin and Pareto items at ≥ 85% on a real model). The scripted baseline can't reach them offline, and the nightly slot that would run them is paused, because no free model can run the full engine within quota. Launch with these marked as deferred, or wait for a model.

## 3. Launch steps (after the yes)

1. Decide item 2 above and commit the nightly results in a PR if that's the choice. Then `bun run readme:assets` and `bun run readme:check`.
2. Follow [LAUNCH.md](LAUNCH.md) "Before going public": the manual README check in light and dark, and rotating any key ever pasted into a chat or transcript. Its first item, the M12 PR, is already merged.
3. Optional, to test the release workflow first: push a pre-release tag (`v0.1.0-rc.1`). It is published as a pre-release, never tagged `latest`, and doesn't need a notes file.
4. Follow LAUNCH.md "Go public":
   - make the repo public;
   - turn on Pages and run the docs workflow;
   - enable private vulnerability reporting;
   - `git tag v0.1.0 && git push origin v0.1.0` (the release workflow builds the image and binaries and publishes `docs/releases/v0.1.0.md`);
   - make the GHCR package public;
   - the fresh-machine quickstart under 10 minutes.
5. Announce per LAUNCH.md "Announce".

The agent does none of these steps. Tags, releases, visibility and settings need the maintainer's explicit yes (AGENTS.md §5, STATE).
