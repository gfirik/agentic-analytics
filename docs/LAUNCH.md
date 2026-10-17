# Launch checklist (v0.1.0)

M12 is a human gate. The agent prepared everything that can be reviewed in a pull request. The steps below are public or irreversible, so the maintainer performs them, in this order.

## Before going public

- [ ] Review and merge the M12 pull request.
- [ ] Manual README check (DOCS-SITE §3): open the README on GitHub in light and in dark mode, and confirm the hero, the Mermaid diagrams, the GIF and both tables render. Record the result in the release PR.
- [ ] Optional: rerun the real-model smoke or full suite with your own model (`bun run eval -- --suite smoke --small-model --model …`) and commit the results file. Then run `bun run readme:assets` so the README table updates.
- [ ] Rotate any API key that was ever pasted into a chat or a terminal transcript.

## Go public

1. Settings → General → Change visibility → **Public**.
2. Settings → Pages → Source: **GitHub Actions**. While the repo was private the `docs` workflow built the site but skipped the Pages upload and deploy; after making it public, rerun the `docs` workflow on main and confirm https://gfirik.github.io/agentic-analytics/ loads.
3. Settings → Security: enable private vulnerability reporting (SECURITY.md points to it).
4. Tag the release: `git tag v0.1.0 && git push origin v0.1.0`. The `release` workflow then pushes `ghcr.io/gfirik/agentic-analytics:0.1.0` and `:latest` and creates the GitHub release from `docs/releases/v0.1.0.md`.
5. Set the GHCR package visibility to public (Packages → agentic-analytics → Settings).
6. Fresh-machine check: on a clean machine, follow only the docs Quickstart and time it from clone to report (target: under 10 minutes).

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
