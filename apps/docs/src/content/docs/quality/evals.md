---
title: How quality is measured
description: Generated businesses with planted events, honest scoring, the bars a release must meet, and checks on real public data.
sidebar:
  order: 1
---

The eval suite runs the whole engine on **30 generated businesses** — 10 archetypes (coffee roaster, printing shop, clinic, online store, distributor, restaurant, SaaS, logistics, construction supplier, agency) × 3 seeded variants — and scores each report against an answer key.

Each dataset plants:

- a key client lost after a price rise (all variants),
- a supplier switch that raises refunds (variant 2),
- a new product cannibalizing an old one (variant 3),
- a ×1000 typo and ambiguous dates, a noise blip inside the band and every December's seasonal peak as **distractors**, and cause documents next to coincidental and irrelevant ones.

**Scoring never reads wording.** A finding matches a planted event by what its code-written first claim states — the metric (mapped by definition, not name), the member, and a comparison that spans the event. Recall counts an event only with the correct driver. A top recommendation about anything else is a miss.

| Metric | v0.1 bar |
|---|---|
| Number mismatches | 0 |
| Planted recall@5 | ≥ 80% |
| Driver accuracy | ≥ 90% |
| Cause grade accuracy | ≥ 80% |
| Distractor FP rate | ≤ 10% |
| Quality-issue recall | ≥ 90% |
| Citation precision | ≥ 95% |
| Recommendation relevance | ≥ 70% |

## Reproduce

```bash
bun run eval -- --suite full --model baseline                        # offline, ~3 minutes
bun run eval -- --suite smoke --small-model --model ollama:qwen3.5:9b  # a real model
```

The **baseline** is a scripted heuristic used to check the harness; it is never presented as model quality. Results: [Eval results](../results/).

### On free GPUs (Kaggle)

The full suite with a 27B model needs no paid API. [evals/kaggle/full-suite-vllm.ipynb](https://github.com/gfirik/agentic-analytics/blob/main/evals/kaggle/full-suite-vllm.ipynb) serves Qwen3.8-27B (4-bit) with vLLM inside a Kaggle notebook on the free 2× T4 GPUs.

- **One business at a time.** Each run is `bun run eval -- --suite full --model configured --only <id> --results-dir <dir>`. It resumes across Kaggle's 12-hour sessions.
- **One row.** `bun run eval:merge -- --label "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ" <part.json>` joins the runs into one model row.
- **Not yet run on Kaggle.** Four points are unverified until the first run, and the startup probes in the notebook's cell c confirm them before the long run:
  1. vLLM 0.30's Gated DeltaNet and Triton attention kernels on the T4's sm_75;
  2. 17.68 GiB of weights plus a 32k context fitting at `--gpu-memory-utilization 0.90`;
  3. `--tool-call-parser qwen3_coder` parsing this quant's tool calls;
  4. `--language-model-only` existing in vLLM 0.30.
- **Steps:** [evals/README.md](https://github.com/gfirik/agentic-analytics/blob/main/evals/README.md#run-the-full-suite-on-kaggle-free-2t4).

## Real public data

Generated data proves the engine finds what was planted. A second tier runs it on public business data with its real mess left in, and checks each report against facts established independently with SQL:

- **UCI Online Retail II** (Chen, 2012, [doi:10.24432/C5CG6D](https://doi.org/10.24432/C5CG6D), CC BY 4.0): a UK online retailer's invoice lines, Dec 2009 – Dec 2011. The engine reads every 10th invoice (105,797 lines). Checks: cancellations (invoice numbers starting with C), missing customer IDs and negative quantities are reported; November is the peak month of 2010 and 2011, matching SQL to the penny; December 2011, which stops on the 9th, is not reported as a collapse.
- **Stats NZ Electronic card transactions, September 2026** (CC BY 4.0; this work is based on Stats NZ's data, licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence): monthly card spending by industry group, 2000–2026, in the official CSV layout (periods written `2002.10`). Checks: the suppressed values of 2000–2002 are reported; December is the peak month of each recent year; the regular January fall is not reported as news.

Every expected number comes from SQL in the answer files, never from the engine. Failed checks stay in the results as known gaps. The data is downloaded and checksum-verified at run time, never committed:

```bash
bun run eval:real:fetch   # download into evals/real/data/ and verify every SHA-256
bun run eval:real         # run the engine, score, update evals/RESULTS.md
```

Results are in the "Real public data" section of [Eval results](../results/).

The same checks run on your own files with `aa eval --suite real --answers <folder>`: see the tutorial [Run evals on your own data](../../learn/tutorials/evals-on-your-data/).
