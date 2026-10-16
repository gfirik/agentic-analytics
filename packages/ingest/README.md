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
| `readWorkbookGrids(bytes)` | SheetJS grid read: values, types, formulas (never evaluated), number formats, merges, hidden sheets. |
| `parseDelimited`, `delimitedToGrid` | CSV/TSV with RFC 4180 quoting and delimiter sniffing. |
| `createDoclingClient(baseUrl, fetch?)` | Optional docling-serve client for PDFs without a text layer. |
| `DEFAULT_LIMITS` | 50 files and 200 MB per job; 50 MB per file; 300 MB decompressed per ZIP; 60 s per file; 2M cells per sheet. |

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
