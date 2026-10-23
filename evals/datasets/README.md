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

## printing-shop-v1

A document corpus for the retrieval eval (docs/specs/retrieval.md §5): a print studio's PDFs, Word files, emails and notes in English and Russian, with planted answers, near-miss distractors and sections long enough to be split. Files in `printing-shop-v1/files/`, built by `printingShopFiles()` (`build:printing-shop`).

## wholesale-margin-v1

A synthetic food wholesaler's invoice lines (518 lines, July 2025 to June 2026, GBP) with a cost column, for M15's margin pack: a margin squeeze at flat revenue (March 2026), a price rise that outruns its cost rise (May 2026) and a distractor inside the noise band. One file, `wholesale-margin-v1/files/invoice-lines.csv`; the columns, their intended roles, the planted events and the hand-computed expected figures (gross margin, margin %, the `pvm_margin.v1` effects) are in `wholesale-margin-v1/README.md`, and machine-readable in `wholesale-margin-v1/expectations.yaml`. Generated deterministically from integer pence (`src/wholesale-margin.ts`, seed 1; `build:wholesale-margin`); tests rebuild the file and re-derive every figure. It is reported as its own group, not in the role-accuracy pool.

## Injection fixtures

`injectionFixtures()` returns the injection suite's fixtures (evals/injection/README.md): each adds one poisoned input to coffee-roaster-v1 (a cell, a PDF, Word file, email, note, or a web page the search returns), with the injected `phrase` that must never reach the planner or the report and the source that must be `flagged`. `build:injection` writes them to `evals/injection/fixtures/`.

## Public API

| Export | Does |
|---|---|
| `wholesaleMarginLines()`, `wholesaleMarginCsv()`, `wholesaleMarginFiles()`, `wholesaleMarginExpectations()`, `referencePvmMargin()`, `WM_*` | wholesale-margin-v1's lines, file, expected figures and planted-event constants |
| `MONTHS`, `COSTS`, `generateOrders()`, `aggregateOrders()`, `coffeeRoasterFiles()` | coffee-roaster-v1's ground truth, transactions and files |
| `buildGoldenReport()`, `goldenReportJson()` | The golden report fixture for coffee-roaster-v1 |
| `EMAIL_BODY`, `EMAIL_EML`, `OPS_NOTES`, `opsNotesDocx()`, `opsNotesText()`, `PRICE_LIST_PAGES`, `pageText(page)`, `salesWorkbook()`, `salesXlsx()` | coffee-roaster-v1's documents and workbook, and their text as an extractor returns it |
| `printingShopFiles()`, `DELIVERY_TERMS`, `HR_NOTES`, `MARKETING_PLAN` | printing-shop-v1's files and its long sections |
| `injectionFixtures()`, `InjectionFixture` | The injection fixtures |
| `docx(sections)`, `eml(headers, body)`, `emlText(headers, body)`, `textPdf(pages)`, `zipStored(entries)`, `crc32(bytes)` | Deterministic file writers (`src/writers.ts`, `pdf.ts`, `zip.ts`); the generator builds its files with them |
| `rng(seed)`, `allocate(total, n, rand)` | The seeded generator and integer allocation the datasets and the generator share |
| `DatasetError` | Typed error with a `code` (`MISSING_COST_ROW`, `MISSING_HASH`, `PDF_NON_ASCII`, `QUOTE_NOT_FOUND`, `UNKNOWN_MONTH`) |

## Example

```bash
bun run --filter @agentic-analytics/eval-datasets build:coffee-roaster   # rebuild files/ (byte-identical)
bun run --filter @agentic-analytics/eval-datasets build:golden-report    # rebuild the report fixture
bun run --filter @agentic-analytics/eval-datasets build:printing-shop    # rebuild printing-shop-v1/files/
bun run --filter @agentic-analytics/eval-datasets build:injection        # rebuild evals/injection/fixtures/
```
