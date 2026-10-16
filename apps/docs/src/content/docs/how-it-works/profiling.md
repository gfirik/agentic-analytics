---
title: Profiling and data quality
description: What the profiler checks, and why data-quality problems are findings of their own.
sidebar:
  order: 3
---

Profiling types every column (dates, currency, percentages, categories, IDs), normalizes values, and looks for problems a careful analyst would flag before trusting any number:

- **Unit and scale errors** — a value 1,000× its neighbours (the coffee example's February packaging cost).
- **Ambiguous dates** — `03/04/2026` read both ways; resolved from rows where the day is above 12, and reported either way.
- **Duplicates, gaps and future dates** — repeated keys, missing periods, dates after "today".
- **Entities** — "OOO Hotel Group" and "Hotel Group LLC" linked as one customer.
- **Injection screening** — table labels and text cells are screened for instructions addressed to a model before any model sees a sample.

Each problem becomes a `data_quality` item in the report, with the cells or rows it concerns. Findings never silently "fix" the data.
