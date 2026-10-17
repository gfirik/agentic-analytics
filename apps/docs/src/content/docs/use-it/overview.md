---
title: One engine, four doors
description: The CLI, the HTTP API, MCP and a Telegram demo, all over the same pipeline and the same verifier.
sidebar:
  order: 0
---

Every door runs the same job: the same stages, the same metric review, and the same verifier. A number means the same thing whether you read it in a terminal, in `report.html`, in an MCP client or in a chat.

| Door | Start it | Best for |
|---|---|---|
| [CLI](../cli/) | `aa analyze <files> --open` | Running a report on your own machine, scripting, `aa ask` and `aa explain` follow-ups |
| [HTTP API](../http-api/) | `aa serve` | Other programs: upload files, stream progress, fetch the report. OpenAPI at `/openapi.json` |
| [MCP](../mcp/) | `aa mcp` (stdio), or `/mcp` while `aa serve` runs | Letting Claude Desktop, Cursor or another agent analyze files and quote verified numbers |
| [Telegram demo](../telegram/) | `bun run --filter @agentic-analytics/telegram start` | Sending files from a phone and getting the summary and report back |

`aa serve` also hosts the [viewer](../viewer/) at `/`: upload files, watch the stages, confirm metrics and read the report in a browser.

From a clone, prefix the commands with `bun run` (for example `bun run aa serve`). The standalone binaries take the same commands (`./aa-linux-x64 serve`).
