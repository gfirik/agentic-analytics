---
title: Web lane and privacy
description: Benchmarks from the web without leaking your data — and never in place of your numbers.
sidebar:
  order: 8
---

The web lane is **off by default** (`--web`). When on, the planner can search for public context — "specialty coffee refund rate benchmark 2026" — through a self-hosted SearXNG.

- **Sanitized queries.** Before a query leaves the machine, the sanitizer removes numbers from your data, customer, supplier and person names, file names, emails and phones. Only public terms remain. The queries actually sent are kept in the job as an audit trail.
- **Safe fetching.** Only http(s) on ports 80/443; every resolved address is checked at connect time (no private, loopback, link-local or metadata addresses); redirects re-checked; size and time limits; text types only.
- **Quarantine.** Pages are screened (readable and hidden text) and read only by the quarantined extractor.
- **External facts.** A percentage quoted on a page ("refunds of 1–2% of sales") becomes an `external_quote` fact citing the URL, and can only feed `benchmark_gap.v1` against a fact of the same unit. External facts are refused everywhere else and always rendered with an **External** badge.
