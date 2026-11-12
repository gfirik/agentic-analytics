# Launch checklist (v0.1.0)

M12 is a human gate. The agent prepared everything that can be reviewed in a pull request. The steps below are public or irreversible, so the maintainer performs them or says yes to each first.

## Before going public

- [ ] Review and merge the M12 pull request.
- [ ] Manual README check (DOCS-SITE §3): open the README on GitHub in light and in dark mode, and confirm the hero, the Mermaid diagrams, the GIF and both tables render. Record the result in the release PR.
- [ ] Optional: rerun the real-model smoke or full suite with your own model (`bun run eval -- --suite smoke --small-model --model …`) and commit the results file. Then run `bun run readme:assets` so the README table updates.
- [ ] Rotate any API key that was ever pasted into a chat or a terminal transcript.

## Go public

Status on 2026-11-12: the repo is public and v0.1.0 is tagged and released. Checked as a logged-out visitor:

1. Visibility: **public** (done).
2. Pages: done. The `docs` workflow deploys on every push to main; https://gfirik.github.io/agentic-analytics/ serves the v0.1 content, including "Which files work in v0.1". To redeploy by hand: `gh workflow run docs.yml --ref main`.
3. Private vulnerability reporting: **enabled** (SECURITY.md points to it).
4. Release: done. `v0.1.0` is on b26a722; the `release` workflow pushed `ghcr.io/gfirik/agentic-analytics:0.1.0` and `:latest` and published https://github.com/gfirik/agentic-analytics/releases/tag/v0.1.0 from `docs/releases/v0.1.0.md`. The four binaries and `SHA256SUMS` download without login.
5. **To do:** set the GHCR package visibility to public (https://github.com/users/gfirik/packages/container/agentic-analytics/settings → Danger Zone → Change visibility). Until then `docker pull ghcr.io/gfirik/agentic-analytics:0.1.0` without login returns `unauthorized`. GitHub has no API for this, so it is done in the web UI.
6. **To do:** fresh-machine check: on a clean machine, follow only the docs Quickstart and time it from clone to report (target: under 10 minutes).

## Announce

Post once the docs site and the image are live. Each post links the repo, the docs and the honest status line.

| Where | When | Angle |
|---|---|---|
| Show HN | a weekday morning, US time | "Show HN: agentic-analytics – a self-hosted AI analyst where the model never does the math" |
| r/selfhosted | **Friday** (the self-hosted day) | fully local: Ollama, SearXNG, DuckDB, one compose file, no telemetry |
| r/LocalLLaMA | any weekday | small-model mode, results per free model, the verifier as the safety net for small models |
| LinkedIn | after HN | for owners and analysts: "what changed, why, and what to do", with every number checkable |
| X | same day as HN | the GIF, plus one line on the verifier |

### Draft: Show HN

> Show HN: agentic-analytics – a self-hosted AI analyst where the model never does the math
>
> You give it a business's spreadsheets, PDFs and emails. It writes a report on what changed, why, and what to do. Every number comes from SQL in DuckDB and is recomputed by a verifier before the report ships. Every claim links to the row, page or URL it came from. Text from your files is read only by a quarantined extractor, and a 23-fixture prompt-injection suite runs in CI.
>
> It runs locally with Ollama or a free endpoint. There's a CLI, an HTTP API, an MCP server and a Telegram bot.
>
> Honest status: it doesn't meet our own eval bars yet. On the smoke suite no free model we tried finds the planted events with the right driver (0% recall@5; the one that completed every job found the key event twice but named the wrong driver). Every result is in evals/RESULTS.md, weak ones included.

### Draft: r/selfhosted

> agentic-analytics: drop in your business exports, get a cited report. It runs entirely on your box (Ollama + SearXNG + DuckDB, one `docker compose up`, no telemetry). The model never does arithmetic: every number is SQL, recomputed by a verifier.

## After launch

- Watch issues and the eval results. A regression of any bar blocks the next release (EVALS §5).
- The next work is the open gaps in docs/progress/STATE.md: seasonal baselines, member-change slots, guarding findings on other data-quality kinds (unit errors are guarded since M12), real-model metric drafting (dimensions, summary sheets), and EXPLAIN degradation.
