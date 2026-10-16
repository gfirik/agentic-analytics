---
title: Ingest and table detection
description: How messy spreadsheets become real tables, and documents become cited sections.
sidebar:
  order: 2
---

Spreadsheets are read as grids (SheetJS), not as text. On each sheet the engine finds **table regions**: blocks of non-empty cells with a header row, including merged or multi-row headers, several tables on one sheet, subtotal and total rows (marked `_is_total`, never summed), and transposed tables. Each table becomes a DuckDB table with typed columns and a `_row` number that points back to the sheet row — which is what citations use.

CSV files are sniffed for delimiter, encoding and quoting. Documents are split into sections that keep their page, heading path and character span: PDF text layers (`unpdf`), DOCX (`mammoth`), emails (`mailparser`, with headers), Markdown and text. Scanned or hard PDFs can go through an optional Docling container.

Limits apply per file and per job (size, sheets, cells, a ZIP-bomb check), and every problem is reported as an ingest issue rather than silently dropped.

See `docs/specs/ingestion-and-profiling.md` for the full rules.
