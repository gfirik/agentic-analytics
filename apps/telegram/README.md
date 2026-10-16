# @agentic-analytics/telegram

The Telegram demo bot (grammY, long polling, so no public URL is needed).

- **Status:** built in M10.
- **Spec:** docs/specs/interfaces.md §4

## Flow

1. Send files. Each is acknowledged; up to 20 per job; Telegram allows bots files up to 20 MB.
2. Send a question (it becomes the job's objective) or `/analyze`, or put the question in a file's caption.
3. The bot calls the engine API with `auto_confirm=true` and edits one status message as stages pass.
4. It replies with the headline, the top 3 findings, the top 2 recommendations and the "metrics were assumed" notice, then sends `report.html`.

## Setup

```bash
bun run aa serve                                   # the engine API on :8080
TELEGRAM_BOT_TOKEN=123:abc bun run --filter @agentic-analytics/telegram start
```

`AA_API_URL` points at another engine (default `http://127.0.0.1:8080`), and `API_TOKEN` is sent as the bearer token.

## Public API

- `createBot(token, api, { download?, botInfo?, maxFiles? })`: a grammY `Bot`.
- `ApiClient`: a small client for the HTTP API (`createJob`, `follow` (SSE), `report`, `reportHtml`), used by the bot.
