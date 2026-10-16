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
TELEGRAM_BOT_TOKEN=123:abc TELEGRAM_ALLOWED_CHATS=<your chat id> bun run --filter @agentic-analytics/telegram start
```

`TELEGRAM_ALLOWED_CHATS` (comma-separated chat ids) lets only you run jobs on your engine and model; other chats are told their id and refused. The bot won't start without it unless `TELEGRAM_PUBLIC=1` says it is meant to be open. First run, when you don't know your id yet: start with `TELEGRAM_ALLOWED_CHATS=1` (a placeholder no real chat has), message the bot, and it replies with your chat id; restart with that id. Errors go to the bot's log; the chat only gets a short message. `AA_API_URL` points at another engine (default `http://127.0.0.1:8080`), and `API_TOKEN` is sent as the bearer token.

## Public API

- `createBot(token, api, { allowedChats?, download?, botInfo?, maxFiles? })`: a grammY `Bot`.
- `ApiClient`: a small client for the HTTP API (`createJob`, `follow` (SSE), `report`, `reportHtml`), used by the bot.
