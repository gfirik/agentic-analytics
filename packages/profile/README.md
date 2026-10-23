# @agentic-analytics/profile

The PROFILE stage. It normalizes ingested tables (dates, numbers, currency, types, `_period`) and loads them into the job workspace. Then it profiles every column and table in DuckDB, runs the implausibility rules, and links entity spellings.

- **Spec:** docs/specs/ingestion-and-profiling.md §5–8
- **Role detector:** docs/specs/semantics.md §1–§2 (M15)
- **Status:** M3; the role detector is M15 PR 4.

## Public API

| Export | Does |
|---|---|
| `profileJob(ws, ingested, { today, grain? })` | The whole stage. Returns the `profile.json` summary: tables with column profiles, issues, entities and assumptions. |
| `normalizeTable(region, grain?)` | Infers column types (date, datetime, integer, decimal, currency, percent, boolean, category, id, text) and normalizes values. A date-named column of `year.month` numbers (`Period`: `2002.10`) is read as months. Whole numbers mixed with letter-prefixed numbers (`489434`, `C489434`) are an `id` column, unless the header names a count. Raises column issues: date-order ambiguity or conflict, mixed currency, unparseable values. |
| `yearMonthOf(n)` | `2002.1` → `2002-10-01`, `2002.01` → `2002-01-01`; undefined for anything that is not a month (`2002.13`, `2002`, years outside 1900–2100). |
| `parseNumber(raw, decimal)`, `detectDecimal(samples)` | `1 234,56` · `1,234.56` · `1.234,56` · `(12)` · `12%` · `$`/`€`/`сум`/`so'm`/`UZS`… The decimal separator is decided per column by majority. |
| `parseDate(raw, order)`, `detectDateOrder(samples)` | ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `mm/dd/yyyy`, Excel serials, EN/RU/UZ month names. dd/mm vs mm/dd uses a per-column majority test; an unresolved column becomes an assumption. |
| `profileTable(ws, table, periodColumn?)` | Null %, distinct, min/max, top 5, median, MAD, MAD outliers (score > 5). Table counts, exact and key duplicates, date coverage with missing months, and the data grain. |
| `runRules(ws, table, profile, today)` | Unit errors (×10/×100/×1000 against the median, on unimodal columns only), negative quantities, rates above 100%, future dates; and one issue per column for `missing_id` (an id-named column empty in some rows), `missing_value` (a number column empty in some rows) and `prefixed_id` (letter-prefixed document numbers among plain ones, often cancellations). |
| `partialLastMonth(tables, grain)`, `previousMonth(p)`, `COMPLETE_SHARE` | The last month when day- or week-level data stops before `COMPLETE_SHARE` (75%) of it (`2011-12` for data ending 2011-12-09); the job leaves it out of the analysis range. |
| `detectRoles(ws, table, profile, { tieBreak? })` | The role detector. For every column: ranked candidates `{ role, score, evidence }` from the header (EN/RU/UZ synonyms, head word, entity + id suffix), the inferred type, value patterns and cross-column identities checked in DuckDB (`quantity × unit_price − discount ≈ amount`, margin, due ≥ issue; each rate is returned as `role_identity.<check>.<table>`). The proposal is the top candidate at 0.4 or more, else `none`. Deterministic, no model; an optional injected `RoleTieBreak` may choose between candidates within 0.1 and can only pick from them. |
| `columnCandidates(column)` | The pure, per-column part of the detector (no SQL): name, type and value signals. |
| `saveRoles(ws, roles)`, `loadRoles(ws, tableId)` | Store the proposals and candidates (`profile_roles`, `profile_role_candidates`, migration 6). |
| `ROLES`, `parseRole(s)`, `RoleError` | The fixed vocabulary (semantics §1) and its typed refusal (`UNKNOWN_ROLE`). |
| `matchEntities(ws, tables)`, `normalizeEntity(raw)` | Customer, supplier and product spellings. Exact after normalization (legal forms, quotes, punctuation, transliteration), else Jaro–Winkler ≥ 0.92 in DuckDB with a token-overlap and same-numbers check. |

## Example

```bash
bun run profile evals/datasets/coffee-roaster-v1/files --today 2026-07-01          # human-readable
bun run profile evals/datasets/coffee-roaster-v1/files --today 2026-07-01 --json   # the profile.json summary
```

```ts
const profile = await profileTable(ws, table, periodColumn);
const roles = await detectRoles(ws, table, profile); // roles.columns[i].role, .score, .evidence; roles.identities
```

`bun run eval:roles` scores the detector against `evals/roles/labels.yaml` (accuracy §11).
