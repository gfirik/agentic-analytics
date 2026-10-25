---
title: Viewer
description: Upload files, watch the pipeline, confirm column roles and metrics and read the report in the browser.
sidebar:
  order: 5
---

`aa serve` hosts the viewer at `http://127.0.0.1:8080/`. Build it once:

```bash
bun run --filter @agentic-analytics/viewer build
bun run aa serve
```

- **Upload** files, with an optional objective, metric review on or off, and the web lane on or off.
- **Live progress:** the pipeline stages light up as the job's events arrive (SSE).
- **Confirmation:** one form for the column roles and the metrics. Each role shows the evidence behind it and a select to change it to any role (or `none`); the table kinds and the business model are shown too. "Update the drafts" has the engine draft the metrics again from your role changes, then each metric appears in plain words with its YAML to edit. Invalid edits, an unknown role or a missing column are refused with the reason.
- **Report:** the self-contained `report.html`, embedded.

When the API requires a token, the viewer sends the one stored in `localStorage["aa-token"]`.
