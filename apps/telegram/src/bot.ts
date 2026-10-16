// The Telegram demo (interfaces §4): send files (and optionally a question), get the headline, the top findings and
// recommendations, and report.html. The bot calls the API with auto_confirm=true, so metrics are assumed and the
// reply says so; one status message is edited as stages pass. Long polling by default: no public URL needed.
import { reportSummaryText } from "@agentic-analytics/report";
import type { Stage } from "@agentic-analytics/schema";
import { Bot, type Context, InputFile } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ApiClient } from "./client.ts";

export interface BotOptions {
  /** Downloads a Telegram file by its `file_path` (default: the Bot API file URL). */
  readonly download?: (filePath: string) => Promise<Uint8Array>;
  /** For tests: skip `getMe`. */
  readonly botInfo?: UserFromGetMe;
  /** Chats allowed to use the bot (TELEGRAM_ALLOWED_CHATS); empty or absent means anyone who finds it. */
  readonly allowedChats?: readonly number[];
  /** Receives a job or delivery error; the chat only gets a short generic message. */
  readonly onError?: (err: unknown) => void;
  /** Most files per job (default 20); Telegram itself caps each at 20 MB for bots. */
  readonly maxFiles?: number;
}

const STAGE_WORDS: Partial<Record<Stage, string>> = {
  INGEST: "Reading files",
  PROFILE: "Profiling tables",
  METRICS_DRAFT: "Drafting metrics",
  MEASURE: "Measuring",
  DETECT: "Finding changes",
  DECOMPOSE: "Breaking changes down",
  INDEX_DOCS: "Reading documents",
  WEB_CONTEXT: "Preparing web search",
  EXPLAIN: "Explaining the changes",
  DECIDE: "Choosing actions",
  VERIFY: "Verifying every number",
  RENDER: "Writing the report",
};

const HELP =
  "Send me your business files (Excel, CSV, PDF, Word, email), then a message with your question or /analyze. I reply with what changed, why, and what to do, plus the full report. Metric definitions are assumed; the report lists them.";

export function createBot(token: string, api: ApiClient, o: BotOptions = {}): Bot {
  const bot = new Bot(token, o.botInfo ? { botInfo: o.botInfo } : {});
  const pending = new Map<number, { name: string; bytes: Uint8Array }[]>();
  const download =
    o.download ??
    (async (path: string) => {
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const run = async (ctx: Context, question?: string) => {
    const chat = ctx.chat?.id;
    if (chat === undefined) return;
    const files = pending.get(chat) ?? [];
    if (!files.length) {
      await ctx.reply("Send one or more files first.");
      return;
    }
    pending.delete(chat);
    const status = await ctx.reply(`Starting: ${files.length} file(s)…`);
    let shown = status.text;
    const show = async (text: string) => {
      if (text === shown) return;
      shown = text;
      await ctx.api.editMessageText(chat, status.message_id, text).catch(() => undefined);
    };
    try {
      const jobId = await api.createJob(files, { auto_confirm: true, ...(question ? { objective: question } : {}) });
      const last = await api.follow(jobId, async (e) => {
        if (e.type === "stage_started" && STAGE_WORDS[e.stage]) await show(`${STAGE_WORDS[e.stage]}…`);
      });
      if (last?.type !== "done") {
        // The code only: an error message can name files, paths or provider details meant for the owner's log.
        if (last?.type === "failed") o.onError?.(new Error(`${last.error.code}: ${last.error.message}`));
        const why = last?.type === "failed" ? `${last.error.code} (details are in the bot's log)` : "the job did not finish";
        await show(`Stopped: ${why}`);
        return;
      }
      await show("Done.");
      const report = await api.report(jobId);
      await ctx.reply(reportSummaryText(report, { findings: 3, recommendations: 2 }));
      const html = await api.reportHtml(jobId);
      await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(html), "report.html"), { caption: `Full report · job ${jobId}` });
    } catch (err) {
      o.onError?.(err);
      await show("Something went wrong (details are in the bot's log).");
    }
  };

  // Jobs use the owner's engine and model: only allowed chats get past this point.
  if (o.allowedChats?.length) {
    const allowed = new Set(o.allowedChats);
    bot.use(async (ctx, next) => {
      if (ctx.chat && allowed.has(ctx.chat.id)) return next();
      if (ctx.chat) await ctx.reply(`This bot is private. Its owner can allow chat ${ctx.chat.id} in TELEGRAM_ALLOWED_CHATS.`);
    });
  }
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));
  bot.command("analyze", (ctx) => run(ctx, ctx.match.trim() || undefined));
  bot.on("message:document", async (ctx) => {
    const chat = ctx.chat.id;
    const list = pending.get(chat) ?? [];
    if (list.length >= (o.maxFiles ?? 20)) {
      await ctx.reply("That's the most files one job takes; send your question or /analyze.");
      return;
    }
    const doc = ctx.message.document;
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) {
      await ctx.reply("Telegram did not give me that file (bots can download files up to 20 MB).");
      return;
    }
    list.push({ name: doc.file_name ?? `file-${list.length + 1}`, bytes: await download(file.file_path) });
    pending.set(chat, list);
    // A caption on a file starts the job right away, with the caption as the question.
    if (ctx.message.caption) return run(ctx, ctx.message.caption);
    await ctx.reply(`Got ${doc.file_name ?? "the file"} (${list.length} file(s)). Send more, or your question / /analyze to start.`);
  });
  bot.on("message:text", (ctx) => {
    // An unknown command is not a question.
    if (ctx.message.text.startsWith("/")) return ctx.reply(HELP);
    return run(ctx, ctx.message.text);
  });
  return bot;
}

/**
 * Who may use the bot: the chats in TELEGRAM_ALLOWED_CHATS. Jobs run on the owner's engine and model keys, so an empty
 * list is refused unless TELEGRAM_PUBLIC=1 says the bot is meant to be open.
 */
export function chatPolicy(env: Readonly<Record<string, string | undefined>>): { allowedChats: number[] } | { error: string } {
  const allowedChats = (env.TELEGRAM_ALLOWED_CHATS ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
  if (allowedChats.length || env.TELEGRAM_PUBLIC === "1") return { allowedChats };
  return {
    error:
      "Set TELEGRAM_ALLOWED_CHATS to your chat id(s) (the bot tells a stranger their id), or TELEGRAM_PUBLIC=1 to let anyone run jobs on this engine.",
  };
}
