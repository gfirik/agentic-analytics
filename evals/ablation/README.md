# @agentic-analytics/eval-ablation

The ablation (docs/specs/accuracy.md §8, analyst-grade §4.5): the same model, the same tasks and the same scoring, with and without the engine. It proves the engine adds accuracy only where a paired bootstrap interval says so.

| Arm | What the model gets |
|---|---|
| A. Model alone | The files as text (each table as CSV rows, each document's text), cut to its context window by whole rows, the cut stated in the input and beside the results |
| B. Model + SQL | The same tables in a locked, per-run DuckDB and one tool, `run_sql`; no metric layer, no verifier |
| C. The engine | The full pipeline |

The prompts are in [src/prompts.ts](src/prompts.ts) and the harness is this package, published so anyone can rerun it (analyst-grade §6.4).

## Containment

Arms A and B break two rules on purpose: arm B runs model-written SQL (AGENTS §2.6) and arm A sends raw untrusted text to a model (§2.5). They are eval-only controls, fenced in (accuracy.md §8.2):

- `run_sql` lives here, never in `packages/agent/tools`; [test/guard.test.ts](test/guard.test.ts) fails if anything under `packages/` or `apps/` imports this package. The entry is its own script, not an `aa` subcommand.
- Arm B's database is built per run in two phases (the source tables only, then a locked reopen: read-only, no file or network access, no extensions, 1 GB memory, 2 threads, a 1 GB spill cap in a per-run temp directory), each statement has a 10 s timeout (`connection.interrupt()`), results stop at 200 rows or 32 KiB, and every refusal or stop is a typed tool error that uses one of the 2 retries. The per-run folder is deleted after the run.
- Every arm has its own model client with no response cache and its own call log, so arm A's text never reaches the engine's prompts or cache.

## Public API

- `ablationCommand(args, deps)` and `ablationArgs(flags, defaults)`: the `bun run eval:ablation` command; it writes `<results>/ablation/<date>-<model>-<suite>[-<dataset>].json|.md`.
- `runAblation(options)`: the arms over a list of jobs (`smokeJobs`, `coffeeGoldenJob`, `realGoldenJobs`), returning an `AblationResult` with per-arm measures and paired comparisons; `ablationMarkdown`, `ablationLines` format it.
- The arms: `runArmA(client, sources, task, contextTokens)` (`armAPrompt`, `armAText` for the cut) and `runArmB(client, sandbox, tables, documents, task)`; `RETRY_BUDGET` is 2.
- The sandbox: `buildSourceDatabase` (phase 1), `SqlSandbox.open` (phase 2, `LOCKED_OPTION_NAMES`, `lockedOptions`), `SqlSandbox.run` (timeout and caps), `classify` (DuckDB's error → `AblationError` code).
- The measures: `proseNumbers` / `claimedNumbers` / `readings` (numbers in prose), `scoreArmItem`, `unsupportedNumbers`, `scoreArmChanges` (the eval's subject matchers), `citationValid`, `goldenMeasures`, `changesMeasures`.
- The scripted run: `scriptedArmA`, `scriptedArmB` (canned FakeModel answers built from the keys) and `scriptedClient`.
- `armModelClient(name, { env, router, log, fetch? })`: an arm's own client, no cache.

## Example

```bash
bun run eval:ablation -- --suite golden --dataset coffee-roaster    # offline, scripted: a harness check
bun run eval:ablation -- --suite smoke                              # offline, scripted, arms A, B and C
bun run eval:real:fetch && bun run eval:ablation -- --arms A,B,C --suite golden --model openai-compatible:groq:openai/gpt-oss-120b
```

A scripted run (`--model baseline`, the default) checks the harness, not a model: arms A and B give canned answers built from the answer keys, and the page says so.
