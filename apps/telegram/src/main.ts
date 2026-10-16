// Starts the Telegram demo with long polling: TELEGRAM_BOT_TOKEN (free from @BotFather), and the engine API at
// AA_API_URL (default http://127.0.0.1:8080, started with `aa serve`), with API_TOKEN if the API requires one.
import { existsSync } from "node:fs";
import { createBot } from "./bot.ts";
import { ApiClient } from "./client.ts";

// Values stay in process.env and are never printed.
if (existsSync(".env")) process.loadEnvFile(".env");
if (process.env.TELEGRAM_BOT_TOKEN === undefined) {
  process.stderr.write("Set TELEGRAM_BOT_TOKEN (create a bot with @BotFather), start the API with `aa serve`, then run again.\n");
  process.exit(1);
}
const api = new ApiClient({
  baseUrl: process.env.AA_API_URL ?? "http://127.0.0.1:8080",
  ...(process.env.API_TOKEN ? { token: process.env.API_TOKEN } : {}),
});
const allowedChats = (process.env.TELEGRAM_ALLOWED_CHATS ?? "")
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((n) => Number.isInteger(n) && n !== 0);
if (!allowedChats.length) process.stderr.write("TELEGRAM_ALLOWED_CHATS is empty: anyone who finds the bot can run jobs on this engine.\n");
const bot = createBot(process.env.TELEGRAM_BOT_TOKEN, api, { allowedChats });
process.once("SIGINT", () => void bot.stop());
process.once("SIGTERM", () => void bot.stop());
await bot.start({
  onStart: (me) => {
    process.stderr.write(`@${me.username} is polling for messages\n`);
  },
});
