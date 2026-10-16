# @agentic-analytics/eval-real

The real-data eval tier (docs/EVALS.md §3). The synthetic suite proves the engine finds what was planted; this tier runs it on public business data as published, with its real mess, and checks the report against facts established independently with SQL.

Nothing here is committed data. `bun run eval:real:fetch` downloads each file, checks its SHA-256, derives the file the engine reads, and checks that file's SHA-256 too. Licences, credits and checksums: [DATASETS.md](DATASETS.md).

## Run it

```bash
bun run eval:real:fetch     # downloads into evals/real/data/ (gitignored); fails loudly on any checksum mismatch
bun run eval:real           # aa eval --suite real --model baseline: runs the engine, scores, updates evals/RESULTS.md
bun run eval:real -- --model openai-compatible:groq:openai/gpt-oss-120b   # a real model for every role
```

`aa eval --suite real` stops with `NO_DATA` when a file is missing, so a partial run is never published. It writes `evals/results/<date>-<model>-real.json` and the "Real public data" section of `evals/RESULTS.md`, and exits 1 when any check fails.

## Datasets

| Id | Data | Licence | The engine reads |
|---|---|---|---|
| `online-retail-ii` | UCI Online Retail II: every line of a UK online retailer's invoices, Dec 2009 – Dec 2011 (1,067,371 lines in two sheets) | CC BY 4.0 | `online_retail_II.sample10.csv`: every invoice whose number is divisible by 10, cancellations included (105,797 lines) |
| `nz-card-spend` | Stats NZ Electronic card transactions, September 2026 release: 137 official series in one long CSV | CC BY 4.0 | `nz-card-spend-by-industry.csv`: the monthly actual values by industry group (series ECTM.S1GA1–8, 2,568 lines), the file's own lines |

Why derive at all:

- **Online Retail II.** The workbook decompresses to more than the engine's 300 MB ZIP limit, so the engine refuses it whole (`DEFAULT_LIMITS` in packages/ingest); the job completes and reports it as too large. Sampling whole invoices by number keeps every invoice's lines together, and a sample by invoice number keeps cancellations, missing customer IDs, negative quantities and the monthly shape. The derivation is a pure function (`deriveOnlineRetailSample`), so its output has a fixed checksum.
- **Stats NZ.** The full CSV puts dollars, counts and percentages, at monthly, quarterly and annual frequency, in one value column. That is not one table to analyse. The slice is what a business user would export, and its lines are unchanged, including the official `2002.10` period format and the suppressed values (status C, blank) of 2000–2002.

## Answer files

`answers/<dataset>.yaml` lists the checks a correct report must pass. Each has `ground_truth` (the DuckDB SQL behind every expected number, with its result) and `checks`:

| Kind | Passes when report.json shows |
|---|---|
| `completes` | a report (no stage failed) |
| `verified` | no number mismatch, re-derivation mismatch or definition violation in `verification` |
| `quality_issue` | a `data_quality` item of the given kind that names the given column |
| `seasonal_peak` | in each listed year, the month with the highest `<metric>_YYYY-MM` fact is one of `months`, and the facts for `values` equal the SQL results within `tolerance` |
| `finding_at` | a finding whose subject (its code-written first claim) is the metric's change at that month, in that direction |
| `no_finding_at` | no finding about that month |
| `seasonal_not_flagged` | no finding on the metric compares one of `months` with the month just before it |

A dataset whose file has no money-named column can name a metrics YAML in `confirmed_metrics`. The runner then uses the product's review flow: the job pauses at AWAIT_CONFIRM, the definitions are confirmed, and it resumes. Checks are written from the data, never from what the engine happens to output; a failed check is an engine gap, recorded in docs/progress/STATE.md.

## Public API

- `REAL_DATASETS`: each dataset's URLs, licence (with the publisher's own wording), citation and checksums.
- `fetchDataset(dataset, { fetch, read, write, print })`: download, verify and derive, with every side effect injected (the tests use no network). Throws `RealDataError` (`DOWNLOAD_FAILED`, `CHECKSUM_MISMATCH`, `ENTRY_MISSING`).
- `verifySha256`, `sha256`, `zipEntry`, `deriveOnlineRetailSample`, `deriveCardSpendByIndustry`, `keepInvoice`, `serialToIso`.
- `parseRealAnswers(yaml)` and the `RealAnswers` / `RealCheck` schema.

Scoring and running live in `@agentic-analytics/eval-runner` (`runRealSuite`, `scoreCheck`, `realEvalCommand`).

## Example

```ts
import { fetchDataset, REAL_DATASETS } from "@agentic-analytics/eval-real";

for (const d of REAL_DATASETS)
  await fetchDataset(d, { fetch, read: readCached, write: saveFile, print: console.error });
```
