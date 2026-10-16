# @agentic-analytics/eval-datasets

Synthetic business datasets with answer keys (docs/EVALS.md §1). M1 ships the hand-built golden dataset. The 30 generated datasets from M11 are in `generated/<id>/answers.yaml` (their files are rebuilt by `evals/generator`).

## coffee-roaster-v1

Mirrors docs/assets/blueprint.html §02. Files in `coffee-roaster-v1/files/`, answer key in `coffee-roaster-v1/answers.yaml`.

| File | Contents and planted events |
|---|---|
| `sales-2026.xlsx` | Sheet `Orders` (6,260 transactions, dd/mm/yyyy text dates → Q2 date ambiguity; "OOO Hotel Group" / "Hotel Group LLC" → E1). Sheet `Monthly`: owner's summary `A1:F7` (the blueprint table) and costs `H1:L7` with a ×1000 typo at `J3` (Q1). |
| `price-list.pdf` | 4 pages; page 2 announces the wholesale price rise |
| `email-0412.eml` | The hotel group pauses its standing order (cause of P1) |
| `ops-notes.docx` | §3: packaging supplier switched on 28 April (timing of P2) |

Everything is generated deterministically from integer-cent ground truth in `src/coffee-roaster.ts`; `Orders` aggregates exactly to `Monthly`. Tests rebuild the files and compare hashes.

## Public API

`MONTHS`, `COSTS`, `generateOrders()`, `aggregateOrders()`, `coffeeRoasterFiles()`, `buildGoldenReport()`, `goldenReportJson()`, plus the small `textPdf` and `zipStored` writers used to build fixtures.

## Example

```bash
bun run --filter @agentic-analytics/eval-datasets build:coffee-roaster   # rebuild files/ (byte-identical)
bun run --filter @agentic-analytics/eval-datasets build:golden-report    # rebuild the report fixture
```
