# Spec: ingestion and profiling

## 1. Intake

- **Limits:** 50 files and 200 MB per job by default, both configurable. Archives are not supported in v0.1 and are rejected with a clear message.
- **Type detection:** file type is sniffed from magic bytes, and the extension is only a hint. Supported types: `xlsx`, `xls` (via SheetJS), `csv`/`tsv`, `pdf`, `docx`, `eml`, `txt`, `md`.
- **Per file:** record `sha256`. Duplicate files, meaning the same hash, are ingested once and the duplicate is noted.
- **Never fatal:**
  - A file that fails to parse becomes a `QualityIssue` (kind `unreadable_file`) and the job continues.
  - Password-protected files become a `QualityIssue` too.
- **Safety:** see specs/security.md §5.

## 2. Spreadsheets: grid read

Use SheetJS to read every sheet into a raw cell grid. For each cell, keep:

- the value;
- the type;
- the formula, if any;
- the number format;
- the merged range it belongs to.

Never evaluate formulas: use the cached values. A missing cached value becomes a `QualityIssue`.

## 3. Table-region detection

Real business sheets hold titles, notes, several tables, blank spacer rows, merged headers and totals.

1. **Occupancy mask.** Build an occupancy mask of non-empty cells. Find connected regions, treating a gap of up to 1 empty row or column as part of the same region.
2. **Score each region as a table.**
   - At least 2 columns and at least 3 data rows.
   - Column type consistency below the header.
   - A header-row candidate: a row of mostly strings above type-consistent rows.
3. **Headers.**
   - Multi-row headers come from merged ranges and stacked string rows. Flatten them as `Parent / Child`.
   - Unmerge by propagating the value across the merged span.
4. **Total and subtotal rows.** Detect them by keywords (`total`, `итого`, `jami`, `subtotal`, `всего`, `sum`) and by sum checks. Mark them `_is_total = true` and exclude them from analysis, but keep them for cross-checks.
5. **Orientation.** Detect transposed tables, where months run across columns. If found, pivot to long format.
6. **Store.** Each region becomes a `sources` row with its A1 range, plus a DuckDB table `t_<id>` holding the normalized columns and `_row`, the original sheet row number.

**Acceptance:** the fixtures in `fixtures/xlsx/` (merged headers, two tables per sheet, transposed months, totals, notes above the table, hidden sheets) all parse to the expected tables in `fixtures/xlsx/expected/*.json`.

## 4. Documents

| Type | Parser | Output |
|---|---|---|
| PDF with text layer | `unpdf` | text per page; tables via heuristics left as text in v0.1 |
| Scanned PDF or a PDF with complex tables | `docling-serve` (optional container) | markdown per page, tables as markdown |
| DOCX | `mammoth` → markdown | sections by heading |
| EML | `mailparser` | headers (from, to, date, subject) + body text; attachments re-enter intake |
| TXT/MD | direct | sections by heading/blank lines |

When Docling is not running, a PDF with no text layer becomes a `QualityIssue` (`needs_ocr`) with the hint "start the docling profile".

Each document is split into sections with page numbers and character offsets. These feed retrieval (specs/retrieval.md).

## 5. Profiling (per table and column)

**Columns:**

- inferred type: date, datetime, integer, decimal, currency, percent, boolean, category, id, text;
- null %;
- distinct count;
- min and max;
- top values;
- outliers by MAD (|x − median| / (1.4826·MAD) > 5).

**Tables:**

- row count;
- duplicate rows (exact, and on the inferred key);
- date coverage, meaning first and last date and missing periods at the inferred grain.

**Implausibility rules** (each becomes a `QualityIssue`):

- negative quantities where the column name suggests a count;
- percentages above 100% where the name suggests a rate;
- future dates;
- sudden ×10 or ×1000 jumps, which suggest a unit or decimal error;
- mixed currencies in one column.

## 6. Normalization

- **Dates:**
  - Formats: ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `mm/dd/yyyy`, Excel serial numbers, and month names in EN/RU/UZ.
  - Ambiguous dd/mm vs mm/dd is resolved per column by a majority test (any value above 12 in either position). If it is still ambiguous, raise an `Assumption`.
- **Numbers:** thousands and decimal separators in several locales (`1 234,56`, `1,234.56`, `1.234,56`), and parentheses for negatives.
- **Currency:** detected from symbols and codes (`$`, `€`, `£`, `сум`, `UZS`, `so'm`, `₽`, and others). v0.1 does not convert currencies. Mixed currencies stay separate and are flagged. Conversion with a user-provided dated FX table is P1.
- **Periods:** a `_period` column at the job grain.

## 7. Entity matching

- **Candidate columns:** names and IDs of customers, products and suppliers, found by name heuristics and the profile.
- **Normalize:** lower-case, strip legal suffixes (`LLC`, `ООО`, `MChJ`, `Ltd`), punctuation and extra spaces, and transliterate Cyrillic to Latin.
- **Match:**
  - Exact match on the normalized value.
  - Otherwise `jaro_winkler_similarity ≥ 0.92` in DuckDB, plus a token-set overlap check.
  - Links with confidence below 0.97 are listed in the report as assumptions.
- **Output:** `entities(id, canonical_name)` and `entity_links(entity_id, source_id, raw_value, confidence)`.

## 8. Outputs of this stage

The `sources`, `t_*`, `profile_*`, `quality_issues`, `entities` and `entity_links` tables, plus a `profile.json` summary that metric drafting uses.
