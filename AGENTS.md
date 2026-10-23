# AGENTS.md: rules for AI coding agents in this repo

Read this file fully before every task. It is the single source of truth for how work is done here. CLAUDE.md points here.

## 1. What we are building

An open-source, self-hosted **agentic analytics engine**. It takes business files in and returns a verified, cited report of what changed, why, and what to do next.

Before writing code, read:

1. `docs/PRD.md`: what, for whom, scope.
2. `docs/ARCHITECTURE.md`: packages and data flow.
3. `docs/ROADMAP.md`: the milestone you are working on and its acceptance criteria.
4. The relevant file in `docs/specs/` for the package you touch.

If the code and a spec disagree, the spec wins. If the spec is wrong, update the spec in the same PR and say so in the PR description.

## 2. Non-negotiable rules

1. **The model never does arithmetic.** Every number in a report comes from SQL executed in DuckDB, or from a deterministic function in `packages/analysis`. A number with no `computation` record attached is a bug.
2. **Every claim carries provenance.** That means a row/cell range, a document page and character span, or a URL. There are no uncited claims in `report.json`.
3. **Free and local first.** No feature may require a paid API. Model providers for v0.x are `ollama` and `openai-compatible` only, which covers free endpoints such as Groq, OpenRouter free models and Cerebras. Do not add paid-provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`) until the roadmap milestone that allows it.
4. **Tests never call a network model.** Unit and integration tests use the scripted `FakeModel` from `packages/models/testing`. Evals that call real models live in `evals/` and run only on explicit command.
5. **Untrusted text stays quarantined.** Text from documents, emails, spreadsheet cells and web pages is only ever read by the quarantined extractor (see `docs/specs/security.md`). It never enters the planner prompt raw, and instructions found inside it are never executed.
6. **No free-form code execution.** The agent can only call the fixed tools defined in `packages/agent/tools`. There is no `eval`, no generated JS or Python, and no shell.
7. **Never commit secrets.** `.env` is gitignored. Example values go in `.env.example`.
8. **Never push to `main`.** Work on a branch and open a PR (see section 5).
9. **No model available is not a blocker.** This machine may have no Ollama and no API key. Everything must build and pass with `FakeModel` plus in-process ONNX embeddings. If an acceptance criterion needs a real LLM and none is configured, mark it `DEFERRED (no model configured)` in STATE.md under "Deferred checks", with the exact command to run later, and continue.
10. **Keep the ledger true.** `docs/progress/STATE.md` is the project's memory between sessions. Update it in every milestone PR: status, PR link, demo command, known gaps, decisions made. Never mark something DONE that wasn't proven.

## 3. Tech stack (do not change without a DECISIONS.md entry)

| Area | Choice |
|---|---|
| Language and runtime | TypeScript, strict mode, Node 22 (runtime; Bun is only the package manager until DuckDB is verified under Bun, D7/D14). Keep code runtime-agnostic: web-standard APIs, no Node-only tricks outside adapters. |
| Repo | Bun workspaces (package manager only, see D14) and Turborepo. Scripts run with `bun run`, one-off tools with `bunx`. |
| Lint and format | Biome |
| Tests | Vitest |
| HTTP | Hono, with `@hono/zod-openapi` for schemas and the OpenAPI spec |
| Database | DuckDB via `@duckdb/node-api`, one database file per job |
| Model layer | Vercel AI SDK (`ai`), wrapped by our own `ModelClient`. Never import `ai` outside `packages/models`. |
| Schemas | Zod. JSON Schema is generated from Zod and never hand-written. |
| Spreadsheets | SheetJS (`xlsx`, community edition from the official CDN tarball) |
| Documents | `unpdf` for text PDFs, `mammoth` for DOCX, `mailparser` for EML. Optional `docling-serve` container for hard PDFs and scans. |
| Embeddings and rerank | `@huggingface/transformers` running in-process, with no install and no Ollama needed. Defaults: `Xenova/bge-m3` or a smaller multilingual ONNX model for embeddings, and a bge-reranker ONNX model. Ollama embeddings are an optional alternative. |
| Web search | SearXNG (self-hosted) by default |
| MCP | `@modelcontextprotocol/sdk` |
| CLI | `citty` |
| Telegram demo | `grammy` |
| Report HTML | React server-side rendering to static HTML |
| Docs site | Astro Starlight |

Do not add LangChain, LlamaIndex, LangGraph, NestJS, Prisma, any vector database, Redis or Python services without a DECISIONS.md entry approved by the maintainer.

## 4. Code conventions

- **Packages:**
  - Each package has `src/`, `test/` and a `README.md` (purpose, public API, example).
  - Public API is exported from `src/index.ts` only.
- **Functions and types:**
  - Pure functions wherever possible. Side effects (filesystem, network, DuckDB) sit behind small interfaces that can be injected.
  - Errors are typed (`class XError extends Error` with a `code`) and never swallowed.
  - No `any`. Use `unknown` and narrow it.
- **SQL:**
  - SQL lives in `.sql.ts` files as tagged templates with parameters. Never concatenate user input into SQL.
  - Every SQL template in `packages/analysis` has a test with a hand-computed expected answer.
- **Logging:** structured logs through `packages/core/log`, with no `console.log` in library code. Every pipeline stage emits a progress event.
- **Comments:** explain why, not what. Every analysis method links to its spec section.

## 5. Git workflow

- **Branches:** `m<milestone>/<short-task>`, for example `m3/profile-dates`.
- **Worktrees:** always inside the repo at `.claude/worktrees/<name>` (`git worktree add .claude/worktrees/<name> -b <branch> origin/main`), never outside it. Remove the worktree and run `git worktree prune` once its branch merges.
- **Commits:** Conventional Commits (`feat(ingest): detect multiple tables per sheet`). Small and focused. Each commit builds and passes tests.
- **Before every push**, run `bun run check`: lint, typecheck, unit tests and the schema-drift check. It must pass.
- **Pull requests:**
  - One PR per milestone (or per task, for big milestones).
  - The description states which acceptance criteria it satisfies, how it was tested, the demo output, and any spec changes.
  - Never force-push shared branches. Never push directly to `main`: every change lands through a PR.
- **Autopilot merge policy.** See `docs/AUTOPILOT.md`. An agent may squash-merge its own PR only when all of these are true:
  1. `scripts/gate.sh` passes locally.
  2. For engine, numeric or security changes: the `spec-reviewer` subagent returns PASS (docs, site, test-only and eval-tooling PRs skip it; §9 "Token budget").
  3. For the same changes: the `qa` subagent has run every acceptance demo and pasted the output in the PR. Otherwise the PR description carries the demo output.
  4. CI is green (`gh pr checks` with all checks passing).
  5. The milestone is not a human gate in `docs/progress/STATE.md`.
  If the milestone is a human gate, set it to `AWAITING_REVIEW` and stop.
- **Remote:** `github.com/gfirik/agentic-analytics`. The repo stays private until the launch milestone.

## 6. Definition of done (every task)

- [ ] Acceptance criteria from `docs/ROADMAP.md` are met and demonstrated (a command and its output in the PR).
- [ ] Unit tests cover the new logic. Analysis code has hand-computed expected values.
- [ ] `bun run check` passes locally, and CI is green.
- [ ] The package README and any affected spec are updated.
- [ ] No new dependency without a one-line justification in the PR. No paid service.
- [ ] The docs site page for the feature is created or updated once the docs site exists (M12+).

## 7. How to work a milestone

Follow the full cycle in `docs/AUTOPILOT.md`. It is the same whether you're running interactively (`/milestone N`) or autonomously (`/autopilot`).

1. Read the milestone in `docs/ROADMAP.md` and its specs.
2. Write a short plan to `docs/plans/m<N>.md`: tasks, order, risks.
3. Build test-first for anything numeric.
4. Run the gate, the reviewer and QA, fix what they find, then open the PR.
5. Don't stop for questions that a reasonable default can answer. Choose the default that best matches the specs and record it in `docs/progress/STATE.md` under "Decisions made by agents".
6. **Don't stop on blockers. Route around them.**
   - **Ambiguous spec:** choose the most spec-consistent option and record it under "Decisions made by agents".
   - **Missing model, service or credential for a check:** mark that check DEFERRED with the exact command to run later, and continue.
   - **Unmet criterion:** implement the closest correct version, record the gap under "Known gaps carried forward", and continue.
   - **Hard stop.** Only mark a milestone `BLOCKED` and stop when the work truly cannot proceed:
     - GitHub auth is missing;
     - a required free dependency can't be installed;
     - work would need money or the maintainer's private credentials.

## 8. Local development

See `docs/ENGINEERING.md`. Short version:

```bash
bun install
cp .env.example .env            # no keys needed; embeddings run in-process
docker compose up -d searxng    # optional: web lane
# optional real LLM: install Ollama and pull a tool-calling model, or put a free GROQ_API_KEY in .env
bun run check
bun run dev                     # API on :8080
```

## 9. Machine resources (laptop limits)

The maintainer's laptop runs out of RAM when agents work in parallel. These rules apply to every agent and session:

- **Agents:** at most one background agent at a time besides the main session, or three under the v0.1 finish plan (§9 "Token budget"). Queue the rest: nothing is skipped, only serialized.
- **Heavy jobs one at a time** across all agents and worktrees: `scripts/gate.sh`, full test runs, builds (including the docs build), evals and Playwright.
  - `gate.sh` takes a machine-wide lock by itself.
  - Run other heavy commands through it too, e.g. `bash scripts/heavy.sh bun run eval -- --suite smoke` or `bash scripts/heavy.sh bun run site:check:browser`.
  - If another heavy job holds the lock, wait for it.
- **Low parallelism inside a job:**
  - Vitest uses at most 2 workers (`vitest.config.ts`); pass `--maxWorkers=2` if you call it another way.
  - Turbo runs with `--concurrency=2`.
  - Playwright runs one browser at a time locally (`workers: 1`).
- **Check memory first:** before a heavy job, check `free -m`. Below about 1.5 GB available, wait for running jobs to finish. `heavy.sh` waits for this automatically on Linux; without `flock` (stock macOS) it warns and runs without the lock, so keep to the rule by hand there.
- **The Stop hook** runs `bun run check` through `heavy.sh --if-free`: when another heavy job holds the lock or RAM is short, it skips that turn's check instead of piling on.
- **Clean up after every job:** make sure its processes are gone (dev and preview servers, watchers, test workers, Chrome/Playwright) and kill leftovers you started. A leftover process can keep holding the heavy lock; `heavy.sh` names the holders' PIDs when it waits.
- **Worktrees:** remove each one as soon as its PR merges (§5).

### Token budget (set by the maintainer, 2026-10-22)

These limits keep model spend down. Where they are tighter than a rule above, they win. There is no daily merge cap and no quiet hours: a PR merges as soon as it is ready.

1. **One background agent** at a time besides the main session.
2. **One PR at a time, end to end.** Don't start the next PR until the current one is merged.

Items 1 and 2 are replaced for M15 and the v0.1 finish by the plan below; items 3 and 4 still hold.
3. **Reviews where they pay.** The `spec-reviewer` and `qa` subagents run only for engine, numeric or security changes. Docs, site, test-only and eval-tooling PRs need only `scripts/gate.sh` and green CI. Reviewer and QA subagents run on a smaller model (Sonnet), not the largest.
4. **No real-model runs** (Groq or any hosted endpoint) except the nightly eval. A targeted check is allowed only when a PR can't be judged otherwise, and the PR says why.

The daily Telegram summary continues.

### The v0.1 finish plan (set by the maintainer, 2026-10-23)

For M15 and the run to v0.1 it replaces items 1 and 2 above.

- **Roles.** The main session (Opus) plans, coordinates, reviews every PR and merges. Builders are subagents on Sonnet.
- **Up to three background agents at once.** Builders, reviewers and QA all count. Check free RAM (`free -m`) before starting a third.
- **Parallel where independent.** M15 PRs 2 and 3 run together; PRs 7, 8 and 9 run together once PRs 4 and 5 are merged. Dependent PRs run one at a time. Heavy jobs (gate, full tests, builds, evals) stay one at a time on the lock.
- **Reviews.** Engine and numeric PRs get the Sonnet `spec-reviewer` and `qa` as before, plus the main session's own review of the diff before merging.
- **Stalls.** If a background agent shows no progress for 30 minutes, the main session checks it and takes over the work itself.
- **After M15 PR 11, a final v0.1 review** by the main session: whole-codebase code quality, a security review, spec against code, docs and README accuracy, and a fresh-clone install plus quickstart run from scratch. Findings are fixed in small PRs. Then `docs/LAUNCH-v0.1.md` gets the launch checklist, and work stops for the maintainer's yes on the v0.1.0 tag.
- **A Telegram after each merge.**
