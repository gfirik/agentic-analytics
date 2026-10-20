# M13l: nightly quota (two-pass runs)

The 2026-10-19 nightly run (`scripts/eval-daily.sh full --small-model`) finished 21 of 30 businesses. Groq's free tier allows 200k tokens a day for the planner (`qwen/qwen3.8-27b`), and that ran out at job 22. The full suite needs about 270k planner tokens, about 9k per business, so one night can't finish it when the prompts have changed since the last run.

## Tasks

1. `aa eval --passes <n>` in the runner (`planResume`, `resumeResult`, `runStatus`, `SuiteResult.passes`). The next night resumes the row's latest result and runs only its unfinished jobs. A run is partial only when jobs are still unfinished after its last pass.
   - A result whose next pass never comes is closed, so it reads partial.
   - A same-day rerun starts a new run.
   - Each role's model is checked before any quota is spent.
   - A corrupt earlier file is set aside.
2. eval-daily.sh passes `--passes 2` and reports the combined state.
3. A `configured` run is named after its routes. The file name stays the same.
4. The labels follow runStatus everywhere: RESULTS.md, the README table, and the landing page (generate.ts → evals.json → index.astro).
5. A second free route for the planner. Cloudflare Workers AI `@cf/qwen/qwen3.8-27b` is documented and covered by a config test. The live check is deferred: there is no token on this machine.
6. Tests use the scripted baseline model with a fake daily quota and never touch the network. Docs: EVALS §3–4, the evals and runner READMEs, the CLI docs, and STATE.

## Risks

- Scores carried over from the first night were produced by that night's code. Only last night's result is resumed, which limits the gap to one day.
- The second night deletes the first night's file. If that file was committed, the deletion has to go in the same PR (EVALS §4).
- The Cloudflare route's tool calls and JSON output have not been checked on a live call.
