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
  /** Most bytes per job (default 195 MB: the API's 200 MB upload limit less room for the multipart framing). */
  readonly maxBytes?: number;
  /** Most bytes held across all chats' waiting files (default 1 GB). */
  readonly maxHeldBytes?: number;
  /** Files waiting for a question are forgotten after this long (default one hour). */
  readonly pendingTtlMs?: number;
  /** Most chats with files waiting at once (default 50), so strangers can't fill the bot's memory. */
  readonly maxPendingChats?: number;
  /** How long to wait for the rest of an album before starting its job (default 1.5 s). */
  readonly albumWaitMs?: number;
}

/** A grammY bot plus `idle()`, which resolves once no job or album is in flight (for tests and a clean shutdown). */
export type AaBot = Bot & { idle(): Promise<void> };

/** The API's limit on an objective (apps/server: `objective` max 500). */
const MAX_QUESTION = 500;

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

export function createBot(token: string, api: ApiClient, o: BotOptions = {}): AaBot {
  const bot = new Bot(token, o.botInfo ? { botInfo: o.botInfo } : {});
  // Under the API's 200 MB upload limit, leaving room for the multipart framing around the files.
  const maxBytes = o.maxBytes ?? 195 * 1024 * 1024;
  const maxHeld = o.maxHeldBytes ?? 1024 * 1024 * 1024;
  const ttl = o.pendingTtlMs ?? 60 * 60 * 1000;
  /** Files each chat sent and hasn't run yet: their total size and when the last one arrived. */
  const pending = new Map<number, { files: { name: string; bytes: Uint8Array }[]; size: number; at: number }>();
  /** Chats with a job running: one at a time per chat. */
  const busy = new Set<number>();
  /** Jobs and album timers in flight, so `idle()` can wait for them. */
  const inFlight = new Set<Promise<unknown>>();
  /** An album being received: Telegram puts its caption on one file, so the job starts once the album is complete. */
  const albums = new Map<number, { id: string; caption?: string; timer: ReturnType<typeof setTimeout> | undefined; done: () => void }>();
  const track = (p: Promise<unknown>) => {
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  };
  const expire = () => {
    const now = Date.now();
    for (const [chat, p] of pending) if (now - p.at > ttl) pending.delete(chat);
  };
  const download =
    o.download ??
    (async (path: string) => {
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const run = async (ctx: Context, chat: number, files: { name: string; bytes: Uint8Array }[], question?: string) => {
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

  /**
   * Starts the chat's job without holding up the update loop: grammY handles updates one at a time, and a job takes
   * minutes, so awaiting it here would leave every other chat (and /help) unanswered until it ends.
   */
  const start = async (ctx: Context, question?: string) => {
    const chat = ctx.chat?.id;
    if (chat === undefined) return;
    if (busy.has(chat)) {
      await ctx.reply("A job is already running for this chat. Send the next files when it finishes.");
      return;
    }
    expire();
    const files = pending.get(chat)?.files ?? [];
    if (!files.length) {
      await ctx.reply("Send one or more files first.");
      return;
    }
    if (question && question.length > MAX_QUESTION) {
      await ctx.reply(
        `That question is ${question.length} characters; the most is ${MAX_QUESTION}. Send a shorter one (your files are kept).`,
      );
      return;
    }
    pending.delete(chat);
    busy.add(chat);
    track(
      run(ctx, chat, [...files], question)
        .catch((err: unknown) => o.onError?.(err))
        .finally(() => busy.delete(chat)),
    );
  };

  // Jobs use the owner's engine and model: only allowed chats get past this point.
  if (o.allowedChats?.length) {
    const allowed = new Set(o.allowedChats);
    bot.use(async (ctx, next) => {
      if (ctx.chat && allowed.has(ctx.chat.id)) return next();
      if (ctx.chat) await ctx.reply(`This bot is private. Its owner can allow chat ${ctx.chat.id} in TELEGRAM_ALLOWED_CHATS.`);
    });
  }
  // A failing update (a file Telegram won't serve, a network error) must not stop polling for everyone else.
  bot.catch((err) => {
    o.onError?.(err.error);
    void err.ctx.reply("Something went wrong (details are in the bot's log).").catch(() => undefined);
  });
  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));
  bot.command("analyze", (ctx) => start(ctx, ctx.match.trim() || undefined));
  /**
   * Holds a chat's album while one of its files downloads: the timer is stopped (a slow download must not let it
   * fire mid-album) and the caption kept. `armAlbum` restarts it once the file is in, or was refused.
   */
  const holdAlbum = (chat: number, group: string, caption: string | undefined) => {
    const album = albums.get(chat);
    const kept = caption ?? (album && album.id === group ? album.caption : undefined);
    if (album) {
      clearTimeout(album.timer);
      album.done();
    }
    albums.set(chat, { id: group, ...(kept ? { caption: kept } : {}), timer: undefined, done: () => {} });
  };
  /** The album's job starts `albumWaitMs` after its last file is in. */
  const armAlbum = (ctx: Context, chat: number, group: string, caption: string | undefined) => {
    const album = albums.get(chat);
    const kept = caption ?? (album && album.id === group ? album.caption : undefined);
    if (album) {
      clearTimeout(album.timer);
      album.done();
    }
    let done = () => {};
    track(new Promise<void>((resolve) => (done = resolve)));
    const timer = setTimeout(() => {
      albums.delete(chat);
      done();
      const n = pending.get(chat)?.files.length ?? 0;
      track(
        (kept
          ? start(ctx, kept)
          : n
            ? ctx.reply(`Got ${n} file(s). Send more, or your question / /analyze to start.`)
            : Promise.resolve()
        ).catch((err: unknown) => o.onError?.(err)),
      );
    }, o.albumWaitMs ?? 1500);
    albums.set(chat, { id: group, ...(kept ? { caption: kept } : {}), timer, done });
  };

  bot.on("message:document", async (ctx) => {
    const chat = ctx.chat.id;
    const group = ctx.message.media_group_id;
    if (group) {
      holdAlbum(chat, group, ctx.message.caption);
      try {
        await addFile(ctx, chat);
      } finally {
        // Wait for the rest of the album from now, then start with its caption (or ask for a question).
        armAlbum(ctx, chat, group, ctx.message.caption);
      }
      return;
    }
    const entry = await addFile(ctx, chat);
    if (!entry) return;
    // A caption on a single file starts the job right away, with the caption as the question.
    if (ctx.message.caption) return start(ctx, ctx.message.caption);
    const name = ctx.message.document.file_name ?? "the file";
    await ctx.reply(`Got ${name} (${entry.files.length} file(s)). Send more, or your question / /analyze to start.`);
  });

  /** Downloads one document into the chat's waiting files, within the limits; undefined when it was refused. */
  const addFile = async (
    ctx: Context & { message: { document: { file_id: string; file_name?: string; file_size?: number } } },
    chat: number,
  ) => {
    expire();
    const tooBig = `That would be over ${Math.round(maxBytes / 1024 / 1024)} MB for one job; send your question or /analyze.`;
    const held = () => [...pending.values()].reduce((n, p) => n + p.size, 0);
    const before = pending.get(chat);
    if (!before && pending.size >= (o.maxPendingChats ?? 50)) {
      await ctx.reply("The bot is holding files for too many chats right now; try again later.");
      return undefined;
    }
    if ((before?.files.length ?? 0) >= (o.maxFiles ?? 20)) {
      await ctx.reply("That's the most files one job takes; send your question or /analyze.");
      return undefined;
    }
    const doc = ctx.message.document;
    if ((before?.size ?? 0) + (doc.file_size ?? 0) > maxBytes) {
      await ctx.reply(tooBig);
      return undefined;
    }
    if (held() + (doc.file_size ?? 0) > maxHeld) {
      await ctx.reply("The bot is holding too many files right now; try again later.");
      return undefined;
    }
    const file = await ctx.api.getFile(doc.file_id);
    if (!file.file_path) {
      await ctx.reply("Telegram did not give me that file (bots can download files up to 20 MB).");
      return undefined;
    }
    const bytes = await download(file.file_path);
    // Read the chat's list again: a job may have started (and taken the earlier files) while this one downloaded.
    const entry = pending.get(chat) ?? { files: [], size: 0, at: Date.now() };
    if (entry.size + bytes.length > maxBytes) {
      await ctx.reply(tooBig);
      return undefined;
    }
    entry.files.push({ name: doc.file_name ?? `file-${entry.files.length + 1}`, bytes });
    entry.size += bytes.length;
    entry.at = Date.now();
    pending.set(chat, entry);
    return entry;
  };
  bot.on("message:text", (ctx) => {
    // An unknown command is not a question.
    if (ctx.message.text.startsWith("/")) return ctx.reply(HELP);
    return start(ctx, ctx.message.text);
  });
  return Object.assign(bot, {
    async idle() {
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    },
  });
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
