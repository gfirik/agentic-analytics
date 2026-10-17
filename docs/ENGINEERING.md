# Engineering guide: setup, git, CI, testing, releases

## 1. Local setup ($0)

**Requirements:**
- Node 22+
- Bun 1.4+ (package manager only; the runtime is Node 22, see D7/D14)
- git
- Docker (optional, for SearXNG and Docling)
- Ollama (for local models)

```bash
git clone git@github.com:gfirik/agentic-analytics.git && cd agentic-analytics
bun install
cp .env.example .env
ollama pull bge-m3            # embeddings (~1.2 GB)
ollama pull qwen3.5:9b        # example local model; any tool-calling model works
bun run check
bun run dev                   # API + viewer on http://localhost:8080
```

**Faster free option for development (no credit card).** Use a free OpenAI-compatible endpoint (Groq, Cerebras, OpenRouter free models, GitHub Models). Put the key in `.env` and point the planner role at it in `agentic-analytics.config.yaml`.

Use free hosted endpoints **only with synthetic eval data**. Some free tiers train on prompts. Real or client data stays on local models.

**On a CPU-only laptop** (e.g. Ryzen 5 7520U), local models are slow. Develop with `FakeModel` tests and a free endpoint, and run local-model evals overnight.

**Optional services:**
```bash
docker compose --profile web up -d       # SearXNG on :8888
docker compose --profile docling up -d   # docling-serve on :5001
```

## 2. Scripts

| Script | Does |
|---|---|
| `bun run check` | biome check + tsc --noEmit + vitest run + schema drift. Must pass before every push. |
| `bun run test` / `bun run test:watch` | unit tests |
| `bun run dev` | server + viewer in watch mode |
| `bun run build` | build all packages and apps |
| `bun run eval:smoke` | end-to-end smoke suite with FakeModel |
| `bun run eval:full --model <profile>` | full eval with a real model (manual) |
| `bun run docs:dev` | docs site locally (from M12) |
| `bun run readme:pipeline` | regenerate the README pipeline GIFs: rerun the engine into `docs/assets/readme/pipeline.json`, then record light/dark GIFs and PNGs from the shared scene. Needs Chrome (`PW_CHANNEL=chrome`, or `bunx playwright install chromium`) and `ffmpeg` on PATH; the frame PNGs (a few hundred MB) go to `AA_FRAMES_DIR` (default: the system temp dir; set it outside a small `/tmp`). Then `bun run readme:assets` and `bun run readme:check` |

## 3. Git workflow

- **Remote:** `github.com/gfirik/agentic-analytics`, private until M12, then public.
- **`main` is protected:**
  - PR required;
  - CI must pass;
  - squash merge only;
  - linear history.
- **Branches:** `m<N>/<task>`, e.g. `m5/pvm-decomposer`.
- **Commits:** Conventional Commits.
  - Types: `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `build`, `ci`, `chore`.
  - Scope is the package or app, e.g. `feat(analysis): add ratemix decomposer with Simpson guard`.
- **PR template** (`.github/pull_request_template.md`):
  - milestone and task;
  - acceptance criteria met (checkboxes);
  - demo command + output;
  - tests added;
  - spec changes;
  - new dependencies with justification.
- **Merging:** follows the autopilot merge policy in AGENTS.md §5 and docs/AUTOPILOT.md. Agents squash-merge their own PRs only after the gate, the reviewer, QA and CI all pass. At human gates (M1, M11, M12), Firdavs merges. Agents never push to `main` directly and never force-push.
- **First push** (done once by the first agent session, after M0):
  ```bash
  git init -b main && git add -A && git commit -m "chore: initial planning docs"
  gh repo create gfirik/agentic-analytics --private --source=. --push
  ```
  Then work moves to the branch `m0/foundation`, and the first PR goes up from it.

## 4. CI (GitHub Actions, free for public repos and within limits for private)

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | PR, push to main | install (`oven-sh/setup-bun`, Bun cache; Node 22 for the runtime) → biome → typecheck → unit tests → schema drift → `eval:smoke` (FakeModel) → injection suite |
| `docs.yml` | PR (build only); push to main and `workflow_dispatch` on main (build + deploy) | build Starlight → deploy GitHub Pages (skipped while the repo is private) |
| `release.yml` | tag `v*` | build → test → Docker image → push to GHCR → GitHub Release with notes |

CI never needs secrets or network models.

## 5. Testing strategy

- **Numeric code:** test-first, with hand-computed expected values written in the test (show the arithmetic in a comment), plus property tests for identities (PVM, contribution sums).
- **Parsers:** fixture files + expected JSON. Every bug found on a real file becomes a new anonymized fixture.
- **Agent:** FakeModel scripted conversations, plus prompt snapshot tests.
- **Verifier:** seeded bad drafts that must be dropped or downgraded.
- **Security:** the injection fixtures and sanitizer/SSRF tests.
- **End to end:** the smoke eval (CI) and the full eval (manual, with results committed).

## 6. Releases

- Versioning follows semver. v0.x may break APIs, but the report schema version is explicit.
- Changesets record user-facing changes. `CHANGELOG.md` is generated.
- **Docker image:** `ghcr.io/gfirik/agentic-analytics:<version>` (free on GHCR).
- **npm publishing of the CLI:** deferred until the product name is final.

## 7. Running several agents in parallel

After M1 locks the contracts, M2, M5 and M6 can run in separate Claude Code sessions. Each one gets its own git worktree inside the repo at `.claude/worktrees/<name>` (`git worktree add .claude/worktrees/m5-analysis -b m5/analysis origin/main`), never as a sibling folder outside the repo, so they never touch the same files. Run one gate at a time on a machine, and never edit a worktree another agent is testing. After the branch merges, `git worktree remove .claude/worktrees/<name>` and `git worktree prune`. On a laptop, keep to AGENTS.md §9: at most two background agents, and heavy jobs (gate, tests, builds, evals, Playwright) one at a time through `scripts/heavy.sh`, which `gate.sh` uses by itself. Each session reads AGENTS.md and only its milestone. Merge order follows ROADMAP dependencies.
