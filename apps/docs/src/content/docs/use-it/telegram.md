---
title: Telegram demo
description: Send files to a bot, get the summary and the report back.
sidebar:
  order: 4
---

The bot talks to the engine only through the HTTP API, so it can run anywhere the API is reachable. It uses long polling: no public URL needed.

```bash
bun run aa serve                                            # the engine
TELEGRAM_BOT_TOKEN=… TELEGRAM_ALLOWED_CHATS=<your chat id> \
  bun run --filter @agentic-analytics/telegram start
```

1. Create a bot with @BotFather (free) and put its token in `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_ALLOWED_CHATS` so only you can run jobs on your engine and model; other chats are told their id and refused. The bot won't start without it (unless `TELEGRAM_PUBLIC=1`). Don't know your id yet? Start with `TELEGRAM_ALLOWED_CHATS=1`, message the bot, and it replies with your id.
3. Send files, then your question (it becomes the objective) or `/analyze`.

The bot runs the job with `auto_confirm=true`, edits one status message as stages pass, then replies with the headline, the top three findings, the top two recommendations, a note that metrics were assumed, and `report.html`.
