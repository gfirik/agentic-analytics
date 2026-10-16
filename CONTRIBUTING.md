# Contributing

Thanks for helping. A few rules keep the engine trustworthy.

## The rules that don't bend

1. **The model never does arithmetic.** Every number comes from SQL in DuckDB or a deterministic function, with its computation attached. New analysis code needs a test with a hand-computed expected value.
2. **Every claim carries provenance:** a row or cell range, a document page and character span, or a URL.
3. **Free and local first.** No feature may require a paid API.
4. **Tests never call a network model.** Use the scripted `FakeModel`. Real-model evals run only on command.
5. **Untrusted text stays quarantined.** Text from files and web pages is read only by the quarantined extractor.

The full list for AI coding agents is in AGENTS.md. It applies to human contributors too.

## Workflow

```bash
bun install
bun run check          # lint, types, tests, schema drift, README drift: no model or key needed
```

- Work on a branch and use Conventional Commits (`feat(ingest): …`, `fix(verify): …`).
- Open a pull request that says what changed, how it was tested, and which spec it follows. If the code and a spec disagree, update the spec in the same PR.
- New dependencies need a one-line justification. Stack changes need an entry in docs/DECISIONS.md.
- The README visuals are generated: run `bun run readme:assets` after changing a diagram, `problems.yaml` or eval results. Record the GIF with `scripts/readme-assets/demo.sh`.

## Where things are

docs/ARCHITECTURE.md has the package map. docs/specs/ has one spec per subsystem. docs/EVALS.md explains how quality is measured.
