# Engineering guide: setup, git, CI, testing, releases

## 1. Local setup ($0)

**Requirements:**
- Node 22+
- pnpm 9+
- git
- Docker (optional, for SearXNG and Docling)
- Ollama (for local models)

```bash
git clone git@github.com:gfirik/agentic-analytics.git && cd agentic-analytics
pnpm i
cp .env.example .env
ollama pull bge-m3            # embeddings (~1.2 GB)
ollama pull qwen3.5:9b        # example local model; any tool-calling model works
pnpm check
pnpm dev                      # API + viewer on http://localhost:8080
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
| `pnpm check` | biome check + tsc --noEmit + vitest run + schema drift. Must pass before every push. |
| `pnpm test` / `pnpm test:watch` | unit tests |
| `pnpm dev` | server + viewer in watch mode |
| `pnpm build` | build all packages and apps |
| `pnpm eval:smoke` | end-to-end smoke suite with FakeModel |
| `pnpm eval:full -- --model <profile>` | full eval with a real model (manual) |
| `pnpm docs:dev` | docs site locally (from M12) |

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
| `ci.yml` | PR, push to main | install (pnpm cache) → biome → typecheck → unit tests → schema drift → `eval:smoke` (FakeModel) → injection suite |
| `docs.yml` | push to main (from M12) | build Starlight → deploy GitHub Pages |
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

After M1 locks the contracts, M2, M5 and M6 can run in separate Claude Code sessions. Each one gets its own git worktree (`git worktree add ../aa-m5 -b m5/analysis`), so they never touch the same files. Each session reads AGENTS.md and only its milestone. Merge order follows ROADMAP dependencies.
