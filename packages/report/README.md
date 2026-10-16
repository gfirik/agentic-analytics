# @agentic-analytics/report

Renders a report v1 (`report.json`) to one self-contained `report.html`: React server-side rendering, inline CSS and a small inline script, no external requests.

- **Spec:** docs/specs/report-schema.md §6. Visual reference: docs/assets/blueprint.html §02.
- **Status:** M1 renderer. Final polish lands with the doors in M10.

## Public API

- `reportSummaryText(report, { findings?, recommendations? })`: headline, top findings and recommendations, and the assumed-metrics notice as plain text, for chat-like doors. `fillPlaceholders(text, facts)` fills `{{N…}}` with formatted fact values.

| Export | Does |
|---|---|
| `renderReportHtml(report)` | Full HTML document as a string |
| `formatValue(value, unit)`, `formatFact(fact)` | Display formatting (rounding for reading only; exact values stay in the computation panel) |
| `formatPeriod(from, to)` | `2026-01`..`2026-06` → `Jan–Jun 2026` |

What the page does:

- Every `{{N…}}` placeholder becomes a button; clicking it shows the fact's exact value, SQL or function, inputs, metric definition and citations. Escape closes it.
- Every citation is a chip; clicking it shows the source in the Evidence panel with the cited rows/cells or quoted passage highlighted. Web sources carry an **External** badge.
- Light and dark themes, keyboard focus styles, print stylesheet. Report text is escaped and written with `textContent` only.

## Example

```bash
bun run --filter @agentic-analytics/report render:fixture   # → packages/report/out/report.coffee-roaster.html
```
