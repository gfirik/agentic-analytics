# evals

The eval suite: how we prove the engine works (docs/EVALS.md). Results are in [RESULTS.md](RESULTS.md).

| Folder | What |
|---|---|
| [generator/](generator/README.md) | The seeded generator of the 30 synthetic businesses (10 archetypes × 3 variants) with planted events |
| [datasets/](datasets/) | Hand-built datasets and the generated answer keys |
| [runner/](runner/README.md) | `aa eval`: runs a suite, scores every report, writes `results/*.json` and `RESULTS.md` |
| [real/](real/README.md) | The real-data tier: public datasets as published, with SQL-backed checks |
| [retrieval/](retrieval/), [injection/](injection/) | Retrieval recall and the prompt-injection suite |
| [kaggle/](kaggle/full-suite-vllm.ipynb) | A Kaggle notebook that runs the full suite on a model served by vLLM in the notebook |
| [results/](results/) | One JSON per published run; RESULTS.md and the README table are generated from these |

```bash
bun run eval -- --suite full --model baseline        # offline, a few minutes
bun run eval -- --suite full --model configured      # the models in .env / agentic-analytics.config.yaml
bash scripts/eval-daily.sh full --small-model         # nightly on a free tier: one run over up to two nights
```

The nightly run (`scripts/eval-daily.sh`, docs/EVALS.md §4) passes `--passes 2`: a free tier's daily quota covers about 21 of the 30 businesses, so the businesses the first night's quota stopped run the next night, and the two passes are published as one result. It is labelled partial only if businesses are still unfinished after the second night.

## Run the full suite on Kaggle (free 2×T4)

[kaggle/full-suite-vllm.ipynb](kaggle/full-suite-vllm.ipynb) runs all 30 businesses with **Qwen3.8-27B in 4 bits** (`avyukth/Qwen3.8-27B-AWQ-INT4`, a W4A16 community quant: Qwen publishes no AWQ). It serves the model with **vLLM 0.30.0 inside the notebook** on Kaggle's free 2× Tesla T4. There is no tunnel, no key and no rate limit.

The notebook writes a results file in the same schema as every other run. It is published as its own model row, **`vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ`**, named `evals/results/<date>-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json`.

> **Not yet run on Kaggle.** The notebook was written and checked without a GPU. Four things are unverified until its first run:
> 1. vLLM 0.30's Gated DeltaNet (FLA/Triton) and Triton attention kernels run Qwen3.8 on the T4's sm_75;
> 2. the 17.68 GiB of weights plus a 32k context fit 2× 15 GB at `--gpu-memory-utilization 0.90`;
> 3. `--tool-call-parser qwen3_coder` parses this quant's tool calls;
> 4. `--language-model-only` exists in vLLM 0.30.
>
> The startup probes in cell c confirm them in the first ~30 min, before the long run: the server must start (1, 2, 4), then answer a structured-output request and a tool-call request (3). If one fails, see Troubleshooting below.

### Steps

1. **Create the notebook.**
   - On kaggle.com, go to *Create → New Notebook*, then *File → Import Notebook*.
   - Upload `evals/kaggle/full-suite-vllm.ipynb`, or paste its GitHub URL.
   - The first cell holds every setting (`REPO_REF`, `MODEL_ID`, `SMALL_MODEL`, `THINKING`, `MAX_MODEL_LEN`, …); the defaults are the published configuration.
2. **Enable the hardware.** In the right panel, under *Session options*:
   - set **Accelerator: GPU T4 ×2**;
   - turn **Internet** on. This needs a phone-verified Kaggle account.
3. **Hugging Face token (optional).** The model is Apache-2.0 and not gated, so no licence needs accepting. If downloads are throttled, add a Hugging Face read token: *Add-ons → Secrets*, name it `HF_TOKEN`, and attach it to the notebook.
4. **Run all.**
   - Use **Save Version → Save & Run All (Commit)**. A committed run runs headless for up to 12 h, and everything in `/kaggle/working` is kept as the version's output.
   - *Run All* in an interactive session works too, but its files are lost if the session dies.
   - First the notebook checks the GPUs, installs vLLM and downloads about 18 GB of weights. Then it starts the server and probes it with one structured-output request and one tool-call request.
   - After that it installs Node 22 and Bun, clones the repo and runs the businesses one at a time (`bun run eval -- --suite full --model configured --only <id>`).
5. **If the run didn't finish in one session**, the last cell says "partial".
   - Open the notebook again and choose *Add Input → Your Work → Notebooks*, then pick this notebook. That attaches the previous version's output.
   - Save & Run All again. The notebook copies the finished businesses and the model response cache in from `/kaggle/input` and continues where it stopped.
   - Repeat until it says "complete".
6. **Download the zip.** Open the version's *Output* tab and download `aa-kaggle-results.zip`. It contains:
   - the merged results JSON and RESULTS.md;
   - `logs/model-calls.jsonl` (every call's role, route, status, latency and tokens; no prompt text);
   - every `reports/<business>.json`, the per-business results in `chunks/`, the vLLM and eval logs, and `settings.json`.
7. **Publish the row.** In your clone:
   ```bash
   git switch -c evals/kaggle-qwen3.8-27b
   cp ~/Downloads/aa-kaggle-results/<date>-vllm-kaggle-2-t4-qwen3.8-27b-awq-full.json evals/results/
   bun run readme:assets
   ```
   - `bun run readme:assets` regenerates both `evals/RESULTS.md` and the README's results table from every file in `evals/results/`.
   - Both list the run as its own row. In the README, its hardware column reads "Kaggle 2×T4 (self-hosted vLLM)".
8. **Open a PR** with the JSON, RESULTS.md and README.md. `bun run check` includes `readme:check`, which fails if either wasn't regenerated.

### Expected runtime

These are estimates: no T4 run has been measured yet, and the notebook prints the real per-business time as it goes.

| Step | Time |
|---|---|
| Setup: install, weight download, vLLM start | ~20–30 min |
| Normal mode, per business | ~10–15 min (decode on 2×T4 at roughly 10–20 tokens/s) |
| Full suite, normal mode | ~5–8 h |
| Full suite, small-model mode | ~roughly half |
| Full suite, `THINKING = True` | several times longer |

- **Sessions.** Kaggle stops a session at 12 h, and GPU time is limited to about 30 h a week. The notebook stops starting new businesses when `SESSION_BUDGET_H` (11 h) would be exceeded, so plan for one or two sessions in normal mode.
- **Thinking.** It's off by default (`--default-chat-template-kwargs '{"enable_thinking": false}'`). Turning it on runs over several sessions through the resume step.
- **Why normal mode.** `SMALL_MODEL = False` by default: a 27B model with no rate limit is what normal mode is for. The Groq rows used small-model mode to fit a 200k-tokens/day quota. Set it to `True` for a faster run that compares directly with those rows; the results file then ends in `-small-full.json`.

### Troubleshooting

- **CUDA out of memory** at start or during a long request. In the first cell:
  - lower `MAX_MODEL_LEN` (32768 → 16384);
  - or lower `GPU_MEM_UTIL` (0.90 → 0.85);
  - or set `ENFORCE_EAGER = True` (no CUDA graphs);
  - then run again. Finished businesses are kept.
- **`libcudart.so.13` not found.** The driver is older than CUDA 13. The install cell picks the `+cu129` wheel when `nvidia-smi` reports CUDA < 13.0; check what cell a printed.
- **vLLM exits while loading.** Read the tail of `aa-out/logs/vllm.log`.
  - **Kernel or shared-memory errors.** These come from Gated DeltaNet or attention on Turing (sm_75): T4 runs only the Triton attention backends, and these layers were tested on Ampere and newer. Try `ENFORCE_EAGER = True`.
  - **Weight-format errors.** Try the other quant, `MODEL_ID = "mattbucci/Qwen3.8-27B-AWQ"`.
  - **Unknown `--language-model-only`.** The pinned vLLM is older than the flag; remove it from the flags list.
- **Tool-call probe fails** ("no tool call parsed").
  - The parser must match the model: `--tool-call-parser qwen3_coder` is the one vLLM documents for Qwen3.5/3.8. Try `hermes` if the model's chat template emits `<tool_call>{json}</tool_call>`.
  - With `THINKING = True`, keep `--reasoning-parser qwen3`, so tool calls aren't hidden in the reasoning text.
- **Structured-output probe fails** (the content is not JSON).
  - Check that thinking is off, or that the reasoning parser is on.
  - Check that the request reached vLLM's guided decoding (`response_format: json_schema`). The `vllm` endpoint in `agentic-analytics.config.yaml` sets `structured_outputs: true`.
- **A business fails with `TIMEOUT`.** One request took longer than `MODEL_TIMEOUT_MS` (15 min). Raise it, then delete that business's folder under `aa-out/chunks/` (or attach the output and run again: a timed-out business is kept as a failure, a connection failure is retried).
- **A business fails with `PROVIDER: … maximum context length`.** Its request outgrew `MAX_MODEL_LEN`. Raise it if memory allows, or run in small-model mode.
