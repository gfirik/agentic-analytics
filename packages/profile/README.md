# @agentic-analytics/profile

The PROFILE stage. It normalizes ingested tables (dates, numbers, currency, types, `_period`) and loads them into the job workspace. Then it profiles every column and table in DuckDB, runs the implausibility rules, and links entity spellings.

- **Spec:** docs/specs/ingestion-and-profiling.md §5–8
- **Status:** M3.

## Public API

| Export | Does |
|---|---|
| `profileJob(ws, ingested, { today, grain? })` | The whole stage. Returns the `profile.json` summary: tables with column profiles, issues, entities and assumptions. |
| `normalizeTable(region, grain?)` | Infers column types (date, datetime, integer, decimal, currency, percent, boolean, category, id, text) and normalizes values. Raises column issues: date-order ambiguity or conflict, mixed currency, unparseable values. |
| `parseNumber(raw, decimal)`, `detectDecimal(samples)` | `1 234,56` · `1,234.56` · `1.234,56` · `(12)` · `12%` · `$`/`€`/`сум`/`so'm`/`UZS`… The decimal separator is decided per column by majority. |
| `parseDate(raw, order)`, `detectDateOrder(samples)` | ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `mm/dd/yyyy`, Excel serials, EN/RU/UZ month names. dd/mm vs mm/dd uses a per-column majority test; an unresolved column becomes an assumption. |
| `profileTable(ws, table, periodColumn?)` | Null %, distinct, min/max, top 5, median, MAD, MAD outliers (score > 5). Table counts, exact and key duplicates, date coverage with missing months, and the data grain. |
| `runRules(ws, table, profile, today)` | Unit errors (×10/×100/×1000 against the median, on unimodal columns only), negative quantities, rates above 100%, future dates. |
| `matchEntities(ws, tables)`, `normalizeEntity(raw)` | Customer, supplier and product spellings. Exact after normalization (legal forms, quotes, punctuation, transliteration), else Jaro–Winkler ≥ 0.92 in DuckDB with a token-overlap and same-numbers check. |

## Example

```bash
bun run profile evals/datasets/coffee-roaster-v1/files --today 2026-07-01          # human-readable
bun run profile evals/datasets/coffee-roaster-v1/files --today 2026-07-01 --json   # the profile.json summary
```
