---
title: Ingest and table detection
description: How spreadsheets with titles, notes and merged headers become real tables, and documents become cited sections.
sidebar:
  order: 2
---

Spreadsheets are read as grids (SheetJS), not as text. On each sheet the engine finds **table regions**: blocks of non-empty cells with a header row, including merged or multi-row headers, several tables on one sheet, subtotal and total rows (marked `_is_total`, never summed), and transposed tables. Each table becomes a DuckDB table with typed columns and a `_row` number that points back to the sheet row — which is what citations use.

CSV files are sniffed for delimiter, encoding and quoting. Documents are split into sections that keep their page, heading path and character span: PDF text layers (`unpdf`), DOCX (`mammoth`), emails (`mailparser`, with headers), Markdown and text. Scanned or hard PDFs can go through an optional Docling container.

Limits apply per file and per job (size, sheets, cells, a ZIP-bomb check), and every problem is reported as an ingest issue rather than silently dropped.

These rules read tidy tables well; wide layouts, count-only tables and filings in HTML are not read as data in v0.1. [Which files work](../../start/which-files/) lists what is read, the header words, and what is not read yet. See `docs/specs/ingestion-and-profiling.md` for the full rules.
