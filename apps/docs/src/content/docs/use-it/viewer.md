---
title: Viewer
description: Upload files, watch the pipeline, confirm metrics and read the report in the browser.
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
- **Metric confirmation:** each drafted definition in plain words, and the YAML to edit; invalid edits are refused with reasons.
- **Report:** the self-contained `report.html`, embedded.

When the API requires a token, the viewer sends the one stored in `localStorage["aa-token"]`.
