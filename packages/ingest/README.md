# @agentic-analytics/ingest

Files in, clean tables and document sections out, with provenance on everything. Nothing is fatal: every problem becomes an issue and the job continues.

- **Spec:** docs/specs/ingestion-and-profiling.md §1–4, docs/specs/security.md §5
- **Status:** M2. M3 loads the output into the job's DuckDB workspace (`sources`, `t_<id>`).

## Public API

| Export | Does |
|---|---|
| `ingest(files, { limits?, docling? })` | Intake (sniff, sha256, dedupe, limits, archive rejection), then per-type parsing. Returns `{ files, tables, documents, documents_meta, issues }`. |
| `sniff(bytes, name)` | File type from magic bytes. The extension is only a hint. |
| `detectTables(grid, opts?)` | Table-region detection on a cell grid: occupancy and 1-gap regions, side-by-side/stacked splitting, notes, multi-row merged headers (`Parent / Child`), unmerging, totals, transposed → long. |
| `readWorkbookGrids(bytes)` | SheetJS grid read: values, types, formulas (never evaluated), number formats, merges, hidden sheets. It does no size check: untrusted bytes go through `ingest`, or `measureZip` first. |
| `measureZip(bytes, cap)` | The true decompressed size of a ZIP (xlsx/docx), measured by inflating each entry with the output counted and discarded; header sizes are ignored. Throws `ZipError` `TOO_LARGE` once the total passes `cap`, or `MALFORMED` for structure a parser could read differently (docs/specs/security.md §5). `ingest` runs it on every xlsx/docx, email attachments included, before SheetJS or mammoth. |
| `parseDelimited`, `delimitedToGrid` | CSV/TSV with RFC 4180 quoting and delimiter sniffing. |
| `createDoclingClient(baseUrl, fetch?)` | Optional docling-serve client for PDFs without a text layer. |
| `DEFAULT_LIMITS` | 50 files and 200 MB per job; 50 MB per file; 300 MB decompressed per ZIP (measured, not read from the headers); 60 s per file. The per-file timeout only fires while a parse awaits something: the spreadsheet, CSV/TSV and text parsers run synchronously, so it can't stop them (known gap M13b, docs/specs/security.md §5). |
| `MAX_CELLS_PER_SHEET` | 2M cells per spreadsheet sheet; a larger sheet is skipped with `too_many_cells`. A separate constant: `limits` can't override it, and it doesn't apply to CSV. |

Provenance:

- **Tables:** every table carries its sheet and A1 range; every row carries its sheet row number (`_row`). Pivoted rows carry the A1 refs of their label, period and value cells.
- **Document sections:** carry a page (PDF), a heading path and char offsets into `documents_meta.texts`.

Issue kinds: `unreadable_file`, `password_protected`, `unsupported_type`, `archive_rejected`, `too_large`, `too_many_files`, `duplicate_file`, `missing_cached_value`, `needs_ocr`, `hidden_sheet`, `too_many_cells`, `no_tables_found`.

## Example

```bash
bun run ingest fixtures/xlsx fixtures/docs evals/datasets/coffee-roaster-v1/files   # prints files, tables, sections, issues
DOCLING_URL=http://localhost:5001 bun run ingest scanned.pdf                        # with docker compose --profile docling up -d
```

```ts
import { ingest } from "@agentic-analytics/ingest";
const { tables, documents, issues } = await ingest([{ name: "sales.xlsx", bytes }]);
```
